#!/usr/bin/env python3
"""Documentor listener for sprint-01 room events."""

from __future__ import annotations

import json
import re
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SKILL_SCRIPT = Path.home() / ".codex/skills/multi-agent-room/scripts/multi-agent-room.py"
ROOM_ID = "sprint-01"
AGENT_NAME = "documentor"
POLL_SECONDS = 5

STATE_PATH = ROOT / ".codex-multi-room/documentor_listener_state.json"
RUNTIME_LOG = ROOT / ".codex-multi-room/documentor_listener_runtime.log"

PROJECT_OVERVIEW = ROOT / "docs/00-ENTRANCE/PROJECT_OVERVIEW.md"
DEBUG_NOTES = ROOT / "docs/05-DEBUG/DEBUG_NOTES.md"
CHANGELOG = ROOT / "docs/05-DEBUG/CHANGELOG.md"
TEST_STRATEGY = ROOT / "docs/04-TESTING/TEST_STRATEGY.md"
DEMAND_ENTRANCE = ROOT / "docs/06-DOCUMENTOR/DEMAND_ENTRANCE.md"


def now_utc8() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M")


def log_runtime(message: str) -> None:
    RUNTIME_LOG.parent.mkdir(parents=True, exist_ok=True)
    line = f"[{now_utc8()}] {message}\n"
    with RUNTIME_LOG.open("a", encoding="utf-8") as f:
        f.write(line)


def run_room(payload: dict[str, Any]) -> dict[str, Any]:
    proc = subprocess.run(
        ["python3", str(SKILL_SCRIPT)],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        cwd=str(ROOT),
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"multi-agent-room failed: {proc.stderr.strip()}")
    stdout = proc.stdout.strip()
    if not stdout:
        raise RuntimeError("multi-agent-room empty stdout")
    try:
        return json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"multi-agent-room non-json stdout: {stdout}") from exc


def append_block(path: Path, title: str, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(f"# {path.name}\n", encoding="utf-8")
    text = path.read_text(encoding="utf-8")
    block_lines = ["", f"### {title}"] + [f"- {line}" for line in lines] + [""]
    text = text.rstrip() + "\n" + "\n".join(block_lines)
    path.write_text(text, encoding="utf-8")


def load_state() -> dict[str, Any]:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "processed_msg_ids": [],
        "counts": {
            "prd": 0,
            "feature": 0,
            "test": 0,
            "milestone": 0,
        },
        "last_poll_ts": None,
        "last_event": "初始化",
        "last_subject": "listener started",
        "last_time": now_utc8(),
        "risk_note": "等待里程碑广播",
    }


def save_state(state: dict[str, Any]) -> None:
    state["processed_msg_ids"] = state.get("processed_msg_ids", [])[-1000:]
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_coverage(text: str) -> str:
    pattern = re.compile(r"覆盖率\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?%?)")
    match = pattern.search(text)
    if not match:
        return "未提供"
    value = match.group(1)
    return value if value.endswith("%") else f"{value}%"


def update_demand_entrance(state: dict[str, Any]) -> None:
    counts = state["counts"]
    content = f"""# 06-DOCUMENTOR/DEMAND_ENTRANCE.md v0.2
*更新：{now_utc8()} | 状态：🟢review | 维护者：@documentor*

## CHANGELOG
- v0.1 -> v0.2：接入自动监听脚本，按事件类型自动同步 PROJECT_OVERVIEW / DEBUG_NOTES / TEST_STRATEGY / CHANGELOG。

| REQ-ID | 描述 | 关键补充 | 状态 | 负责人 | 截止 |
|--------|------|----------|------|--------|------|
| DOC-001 | sprint-01 事件监听与文档同步 | 已完成事件计数：PRD={counts['prd']}，功能={counts['feature']}，测试={counts['test']}，里程碑={counts['milestone']}。最近事件：{state['last_event']}（{state['last_subject']}）。 | 🟢review | documentor | 2026-03-24 |

## 浓缩上下文
- 当前重点：持续监听 `sprint-01` 的 `ALL event`，收到消息即更新文档并回传 done。
- 已完成：已消费事件 PRD={counts['prd']} / 功能={counts['feature']} / 测试={counts['test']} / 里程碑={counts['milestone']}。
- 阻塞/风险：{state['risk_note']}。
- 下一步：继续轮询；若收到里程碑广播，立即写入阶段总结并结束监听。
- 需要谁接手：里程碑后由 `arch_perf_dev` 进行总收口与下一阶段任务分发。
"""
    DEMAND_ENTRANCE.parent.mkdir(parents=True, exist_ok=True)
    DEMAND_ENTRANCE.write_text(content, encoding="utf-8")


def send_done(event_name: str, files: list[Path], msg_id: str) -> None:
    artifact = ", ".join(str(path.relative_to(ROOT)) for path in files)
    payload = {
        "room_id": ROOM_ID,
        "agent_name": AGENT_NAME,
        "outgoing": {
            "task_id": f"DOC-DONE-{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
            "to": "arch_perf_dev",
            "type": "done",
            "subject": f"文档已更新（{event_name}）",
            "body": f"已处理消息 {msg_id}，更新文件：{artifact}",
            "context": {"artifact": artifact},
        },
    }
    run_room(payload)


def classify_event(subject: str, body: str) -> str:
    merged = f"{subject} {body}"
    if "里程碑" in merged:
        return "milestone"
    if "PRD" in merged and ("更新" in merged or "发布" in merged):
        return "prd"
    if "测试完成" in merged or "覆盖率" in merged:
        return "test"
    if "功能完成" in merged or "功能实现完成" in merged:
        return "feature"
    return "other"


def handle_event(msg: dict[str, Any], state: dict[str, Any]) -> tuple[str, list[Path], bool]:
    subject = msg.get("subject") or "(无标题)"
    body = msg.get("body") or ""
    msg_id = msg.get("msg_id") or "unknown"
    from_agent = msg.get("from_agent") or "unknown"
    event_type = classify_event(subject, body)

    files: list[Path] = []
    ts = now_utc8()

    if event_type == "prd":
        append_block(
            PROJECT_OVERVIEW,
            f"事件同步（{ts}）",
            [
                "类型：PRD更新",
                f"来源：{from_agent} / {msg_id}",
                f"主题：{subject}",
                f"内容：{body}",
            ],
        )
        append_block(
            CHANGELOG,
            f"文档同步（{ts}）",
            [
                f"[PRD更新] {subject}",
                f"消息：{msg_id} / 来源：{from_agent}",
            ],
        )
        state["counts"]["prd"] += 1
        files.extend([PROJECT_OVERVIEW, CHANGELOG])
        event_name = "PRD更新"
        stop = False
    elif event_type == "feature":
        append_block(
            DEBUG_NOTES,
            f"事件同步（{ts}）",
            [
                "类型：功能完成",
                f"来源：{from_agent} / {msg_id}",
                f"主题：{subject}",
                f"内容：{body}",
            ],
        )
        append_block(
            CHANGELOG,
            f"文档同步（{ts}）",
            [
                f"[功能完成] {subject}",
                f"消息：{msg_id} / 来源：{from_agent}",
            ],
        )
        state["counts"]["feature"] += 1
        files.extend([DEBUG_NOTES, CHANGELOG])
        event_name = "功能完成"
        stop = False
    elif event_type == "test":
        coverage = parse_coverage(f"{subject} {body}")
        append_block(
            TEST_STRATEGY,
            f"覆盖率同步（{ts}）",
            [
                "类型：测试完成",
                f"来源：{from_agent} / {msg_id}",
                f"主题：{subject}",
                f"覆盖率：{coverage}",
                f"内容：{body}",
            ],
        )
        append_block(
            CHANGELOG,
            f"文档同步（{ts}）",
            [
                f"[测试完成] {subject}（覆盖率：{coverage}）",
                f"消息：{msg_id} / 来源：{from_agent}",
            ],
        )
        state["counts"]["test"] += 1
        files.extend([TEST_STRATEGY, CHANGELOG])
        event_name = "测试完成"
        stop = False
    elif event_type == "milestone":
        counts = state["counts"]
        append_block(
            DEBUG_NOTES,
            f"阶段总结（{ts}）",
            [
                "触发：里程碑达成广播",
                f"来源：{from_agent} / {msg_id}",
                f"主题：{subject}",
                f"内容：{body}",
                (
                    "本阶段统计："
                    f"PRD更新={counts['prd']}，功能完成={counts['feature']}，"
                    f"测试完成={counts['test']}"
                ),
                "结论：documentor 已完成阶段文档同步并结束监听。",
            ],
        )
        append_block(
            CHANGELOG,
            f"文档同步（{ts}）",
            [
                f"[里程碑] {subject}",
                f"消息：{msg_id} / 来源：{from_agent}",
            ],
        )
        state["counts"]["milestone"] += 1
        files.extend([DEBUG_NOTES, CHANGELOG])
        event_name = "里程碑达成"
        stop = True
    else:
        append_block(
            CHANGELOG,
            f"文档同步（{ts}）",
            [
                f"[未归类事件] {subject}",
                f"消息：{msg_id} / 来源：{from_agent}",
                f"内容：{body}",
            ],
        )
        files.append(CHANGELOG)
        event_name = "未归类事件"
        stop = False

    state["last_event"] = event_name
    state["last_subject"] = subject
    state["last_time"] = ts
    state["risk_note"] = "无新增阻塞；持续等待里程碑广播。"
    update_demand_entrance(state)
    files.append(DEMAND_ENTRANCE)

    return event_name, files, stop


def main() -> int:
    log_runtime("listener booted")
    state = load_state()
    state.setdefault("last_poll_ts", None)

    # Startup sync: keep entrance context fresh.
    update_demand_entrance(state)
    save_state(state)

    while True:
        try:
            payload = {"room_id": ROOM_ID, "agent_name": AGENT_NAME}
            if state.get("last_poll_ts"):
                payload["last_ts"] = state["last_poll_ts"]
            response = run_room(payload)
            inbox = response.get("inbox", [])
            state["last_poll_ts"] = response.get("next_poll", state.get("last_poll_ts"))
            save_state(state)
            if inbox:
                log_runtime(f"pulled inbox with {len(inbox)} message(s)")
            for msg in inbox:
                msg_id = msg.get("msg_id") or ""
                if msg_id and msg_id in state["processed_msg_ids"]:
                    continue
                if msg.get("type") != "event":
                    # Non-event messages were already handled during assignment/ack stage.
                    if msg_id:
                        state["processed_msg_ids"].append(msg_id)
                        save_state(state)
                    continue

                event_name, files, stop = handle_event(msg, state)
                send_done(event_name, files, msg_id or "unknown")

                if msg_id:
                    state["processed_msg_ids"].append(msg_id)
                save_state(state)
                log_runtime(f"processed event {msg_id} as {event_name}")

                if stop:
                    log_runtime("milestone received; listener exits")
                    return 0

        except Exception as exc:
            log_runtime(f"error: {exc}")

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    raise SystemExit(main())
