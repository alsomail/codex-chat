from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CapturePlan:
    logcat_file: Path
    screenshot_file: Path
    screenrecord_file: Path
    ui_dump_file: Path


def build_capture_plan(artifact_dir: Path, label: str) -> CapturePlan:
    safe_label = label.replace("/", "_").replace(" ", "_")
    return CapturePlan(
        logcat_file=artifact_dir / f"{safe_label}.logcat.txt",
        screenshot_file=artifact_dir / f"{safe_label}.png",
        screenrecord_file=artifact_dir / f"{safe_label}.mp4",
        ui_dump_file=artifact_dir / f"{safe_label}.uiautomator.xml",
    )


def format_filter_expr(markers: list[str]) -> str:
    cleaned = [marker.strip() for marker in markers if marker.strip()]
    return " | ".join(cleaned) if cleaned else "socket.error | session.reconnect | room.recover_hint"
