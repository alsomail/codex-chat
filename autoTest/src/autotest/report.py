from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
import json

from .models import FlowReport


def render_markdown(report: FlowReport) -> str:
    lines = [
        "# REQ-004 Autotest Report",
        "",
        f"- mode: `{report.mode}`",
        f"- probe_url: `{report.probe.url}`",
        f"- probe_ok: `{report.probe.ok}`",
        f"- probe_status: `{report.probe.status_code}`",
        f"- diagnosis: `{report.diagnosis}`",
        "",
        "## Steps",
    ]
    for step in report.steps:
        status = "PASS" if step.ok else "FAIL"
        lines.append(f"- `{step.name}`: {status} - {step.detail}")
    if report.notes:
        lines.extend(["", "## Notes"])
        lines.extend(f"- {note}" for note in report.notes)
    return "\n".join(lines) + "\n"


def render_json(report: FlowReport) -> str:
    payload = {
        "mode": report.mode,
        "probe": {
            "url": report.probe.url,
            "ok": report.probe.ok,
            "status_code": report.probe.status_code,
            "elapsed_ms": report.probe.elapsed_ms,
            "body_preview": report.probe.body_preview,
            "error": report.probe.error,
        },
        "steps": [
            {"name": step.name, "ok": step.ok, "detail": step.detail}
            for step in report.steps
        ],
        "diagnosis": report.diagnosis,
        "artifact_dir": str(report.artifact_dir),
        "notes": list(report.notes),
    }
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def write_report(report: FlowReport, directory: Path) -> tuple[Path, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    markdown = directory / "req004_report.md"
    json_file = directory / "req004_report.json"
    markdown.write_text(render_markdown(report), encoding="utf-8")
    json_file.write_text(render_json(report), encoding="utf-8")
    return markdown, json_file
