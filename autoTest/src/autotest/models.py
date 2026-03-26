from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class DeviceInfo:
    serial: str
    state: str
    details: str = ""


@dataclass(frozen=True)
class ProbeResult:
    url: str
    ok: bool
    status_code: int | None
    elapsed_ms: float
    body_preview: str = ""
    error: str | None = None


@dataclass(frozen=True)
class FlowStep:
    name: str
    action: str
    expected: str
    command: list[str] | None = None
    manual_checkpoint: bool = False


@dataclass(frozen=True)
class StepResult:
    name: str
    ok: bool
    detail: str


@dataclass(frozen=True)
class FlowReport:
    mode: str
    probe: ProbeResult
    steps: tuple[StepResult, ...]
    diagnosis: str
    artifact_dir: Path
    notes: tuple[str, ...] = field(default_factory=tuple)
