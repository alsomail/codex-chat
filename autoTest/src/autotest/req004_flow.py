from __future__ import annotations

from pathlib import Path
from time import sleep

from .adb import AdbClient
from .capture import build_capture_plan, format_filter_expr
from .config import AutoTestConfig
from .models import FlowReport, FlowStep, ProbeResult, StepResult
from .service_probe import ServiceProbe, classify_issue
from .ui_dump import build_ui_signal_blob, read_uiautomator_texts


class Req004Flow:
    def __init__(self, config: AutoTestConfig, adb: AdbClient, artifact_root: Path) -> None:
        self.config = config
        self.adb = adb
        self.artifact_root = artifact_root
        self.capture_dir = artifact_root / config.capture.artifact_dir
        self.capture_dir.mkdir(parents=True, exist_ok=True)

    def build_plan(self) -> tuple[FlowStep, ...]:
        app = self.config.app
        return (
            FlowStep(
                name="service-preflight",
                action=f"Probe {app.base_url.rstrip('/')}{app.health_path}",
                expected="Service health endpoint responds.",
            ),
            FlowStep(
                name="adb-preflight",
                action="List attached adb devices and check binary availability.",
                expected="At least one device is attached for real-device mode.",
            ),
            FlowStep(
                name="launch-app",
                action=f"Launch {app.package_name}/{app.launcher_activity}",
                expected="ChatRoom login screen appears.",
                command=self.adb.build_command("shell", "am", "start", "-n", f"{app.package_name}/{app.launcher_activity}"),
            ),
            FlowStep(
                name="manual-login",
                action="Enter phone and OTP, then confirm socket connection logs.",
                expected="Login succeeds and socket.error does not appear.",
                manual_checkpoint=True,
            ),
            FlowStep(
                name="manual-room-flow",
                action="Join a room, observe reconnect token, then toggle network and recover.",
                expected="session.reconnect / session.reconnected / room.recover_hint are visible.",
                manual_checkpoint=True,
            ),
        )

    def run(self, dry_run: bool = True) -> FlowReport:
        probe_url = self.config.app.base_url.rstrip("/") + self.config.app.health_path
        if dry_run:
            probe = ProbeResult(
                url=probe_url,
                ok=False,
                status_code=None,
                elapsed_ms=0.0,
                body_preview="",
                error="dry-run: service probe skipped",
            )
        else:
            probe = ServiceProbe(self.config.app.base_url, self.config.app.health_path).probe()
        steps: list[StepResult] = []
        notes: list[str] = []

        try:
            self.adb.ensure_available()
            steps.append(StepResult(name="adb-version", ok=True, detail="adb binary is available."))
        except Exception as exc:  # noqa: BLE001
            steps.append(StepResult(name="adb-version", ok=False, detail=str(exc)))
            notes.append("adb availability check failed.")
            dry_run = True

        devices = []
        try:
            devices = self.adb.list_devices()
            steps.append(StepResult(name="adb-devices", ok=bool(devices), detail=", ".join(f"{d.serial}:{d.state}" for d in devices) or "no devices attached"))
        except Exception as exc:  # noqa: BLE001
            steps.append(StepResult(name="adb-devices", ok=False, detail=str(exc)))
            notes.append("adb device discovery failed.")
            dry_run = True

        plan = build_capture_plan(self.capture_dir, "req004")
        steps.append(StepResult(name="capture-plan", ok=True, detail=f"logcat={plan.logcat_file.name}, screenshot={plan.screenshot_file.name}, record={plan.screenrecord_file.name}"))

        if not dry_run and devices:
            launch_result = self.adb.launch_app(self.config.app.package_name, self.config.app.launcher_activity)
            steps.append(StepResult(name="launch-app", ok=launch_result.returncode == 0, detail=launch_result.stdout.strip() or launch_result.stderr.strip() or "launch issued"))
            sleep(self.config.flow.wait_seconds_after_launch)
            self._capture_logcat(plan.logcat_file)
            self._capture_ui_dump(plan.ui_dump_file)
        else:
            steps.extend(
                [
                    StepResult(name="launch-app", ok=True, detail="dry-run: launch skipped."),
                    StepResult(name="capture-logcat", ok=True, detail="dry-run: logcat capture skipped."),
                    StepResult(name="capture-ui", ok=True, detail="dry-run: UI capture skipped."),
                ]
            )

        if dry_run:
            diagnosis = "dry_run_only"
            notes.append("Service health preflight skipped in dry-run.")
        else:
            observations = self._read_log_lines(plan.logcat_file) + read_uiautomator_texts(plan.ui_dump_file)
            diagnosis = classify_issue(observations, probe.ok)
            if probe.ok:
                notes.append("Service health preflight passed.")
            else:
                notes.append("Service health preflight failed; socket failures are likely networking or reachability related.")
            ui_blob = build_ui_signal_blob(read_uiautomator_texts(plan.ui_dump_file))
            if ui_blob:
                notes.append(f"ui_observations={len(ui_blob.splitlines())}")

        return FlowReport(
            mode="dry-run" if dry_run else "real-device",
            probe=probe,
            steps=tuple(steps),
            diagnosis=diagnosis,
            artifact_dir=self.capture_dir,
            notes=tuple(notes),
        )

    def _capture_logcat(self, target_file: Path) -> None:
        result = self.adb.logcat_dump(lines=self.config.capture.logcat_buffer_lines)
        target_file.write_text(result.stdout, encoding="utf-8")

    def _capture_ui_dump(self, target_file: Path) -> None:
        remote_path = "/sdcard/req004_window_dump.xml"
        self.adb.dump_ui(remote_path)
        self.adb.run("pull", remote_path, str(target_file))
        if not target_file.exists():
            target_file.write_text("", encoding="utf-8")

    def _read_log_lines(self, path: Path) -> list[str]:
        if not path.exists():
            return []
        return path.read_text(encoding="utf-8", errors="replace").splitlines()
