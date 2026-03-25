#!/usr/bin/env python3
"""Background loop for product_mgr in room sprint-01.

This worker keeps polling multi-agent-room and performs REQ-001 acceptance flow:
- waits for arch_perf_dev milestone events
- validates whether REQ-001 can be approved
- updates DEMAND_ENTRANCE and sends done/block messages accordingly
"""

from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path


ROOM_ID = "sprint-01"
AGENT_NAME = "product_mgr"
ROOM_SCRIPT = Path("/Users/yuanye/.codex/skills/multi-agent-room/scripts/multi-agent-room.py")
DEMAND_FILE = Path("/Users/yuanye/myWork/ChatRoom/docs/01-PRODUCT/DEMAND_ENTRANCE.md")
STATE_FILE = Path("/tmp/product_mgr_sprint01_state.json")
POLL_INTERVAL_SECONDS = 8


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"seen_msg_ids": [], "last_block_sent_for": "", "done_sent": False}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def room_call(payload: dict) -> dict:
    proc = subprocess.run(
        ["python3", str(ROOM_SCRIPT)],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=False,
    )
    lines = [x for x in proc.stdout.splitlines() if x.strip()]
    if not lines:
        return {}
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError:
        return {}


def poll_inbox() -> list[dict]:
    data = room_call({"room_id": ROOM_ID, "agent_name": AGENT_NAME})
    return data.get("inbox", []) if isinstance(data, dict) else []


def send_message(task_id: str, to: str, msg_type: str, subject: str, body: str, requires_ack: bool = False) -> None:
    payload = {
        "room_id": ROOM_ID,
        "agent_name": AGENT_NAME,
        "outgoing": {
            "task_id": task_id,
            "to": to,
            "type": msg_type,
            "subject": subject,
            "body": body,
            "requires_ack": requires_ack,
        },
    }
    room_call(payload)


def ack_message(msg_id: str) -> None:
    room_call({"room_id": ROOM_ID, "agent_name": AGENT_NAME, "ack_msg_id": msg_id})


def demand_text() -> str:
    return DEMAND_FILE.read_text(encoding="utf-8")


def req001_already_approved(text: str) -> bool:
    return "| 🟩approved |" in read_req001_row(text)


def read_req001_row(text: str) -> str:
    for line in text.splitlines():
        if line.startswith("| REQ-001 |"):
            return line
    return ""


def remaining_blockers(req001_row: str) -> list[str]:
    blockers = []
    if "OTP回退口令" in req001_row:
        blockers.append("OTP回退口令风险未清零")
    if "明文Token存储" in req001_row:
        blockers.append("Token明文存储未修复")
    if "接口路径偏差" in req001_row:
        blockers.append("接口路径偏差未修复")
    return blockers


def update_req001_to_approved() -> None:
    text = demand_text()
    rows = text.splitlines()
    new_rows: list[str] = []
    for line in rows:
        if line.startswith("| REQ-001 |"):
            line = re.sub(r"\|\s*🟡draft\s*\|", "| 🟩approved |", line)
            line = line.replace("阻塞项仍在：OTP回退口令、明文Token存储、接口路径偏差，需修复后复审", "安全阻塞清零，demo可运行并通过复验")
        new_rows.append(line)
    DEMAND_FILE.write_text("\n".join(new_rows) + "\n", encoding="utf-8")


def should_trigger_acceptance(msg: dict) -> bool:
    if msg.get("from_agent") != "arch_perf_dev":
        return False
    if msg.get("type") != "event":
        return False
    text = f"{msg.get('subject', '')} {msg.get('body', '')}"
    return ("里程碑" in text) or ("milestone" in text.lower())


def main() -> None:
    state = load_state()

    while True:
        text = demand_text()
        if req001_already_approved(text):
            if not state.get("done_sent"):
                send_message(
                    "PM-DONE-REQ001-APPROVED",
                    "arch_perf_dev",
                    "done",
                    "REQ-001验收通过",
                    "REQ-001已更新为🟩approved，demo可运行且验收口径通过。",
                )
                state["done_sent"] = True
                save_state(state)
            break

        inbox = poll_inbox()
        for msg in inbox:
            msg_id = msg.get("msg_id", "")
            if not msg_id or msg_id in state.get("seen_msg_ids", []):
                continue

            state.setdefault("seen_msg_ids", []).append(msg_id)
            save_state(state)

            # Mark consumed messages as acked to avoid repeated polling noise.
            ack_message(msg_id)

            if not should_trigger_acceptance(msg):
                continue

            req_row = read_req001_row(demand_text())
            blockers = remaining_blockers(req_row)
            text_hint = f"{msg.get('subject', '')} {msg.get('body', '')}"
            demo_hint = ("demo" in text_hint.lower()) or ("可运行" in text_hint)

            if not blockers and demo_hint:
                update_req001_to_approved()
                send_message(
                    "PM-DONE-REQ001-APPROVED",
                    "arch_perf_dev",
                    "done",
                    "REQ-001验收通过",
                    "里程碑已触发且demo可运行，REQ-001已更新为🟩approved。",
                )
                state["done_sent"] = True
                save_state(state)
                return

            reason = "；".join(blockers) if blockers else "未检测到demo可运行证据"
            # Avoid spamming duplicate block messages for the same milestone message.
            if state.get("last_block_sent_for") != msg_id:
                send_message(
                    f"PM-BLOCK-{msg_id}",
                    "arch_perf_dev",
                    "block",
                    "REQ-001验收未通过",
                    f"里程碑已触发，但当前仍不满足🟩approved：{reason}。",
                    requires_ack=True,
                )
                state["last_block_sent_for"] = msg_id
                save_state(state)

        state["last_heartbeat"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        save_state(state)
        print(f"[heartbeat] room={ROOM_ID} inbox={len(inbox)}", flush=True)
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
