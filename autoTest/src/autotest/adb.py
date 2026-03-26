from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import subprocess

from .models import DeviceInfo


@dataclass(frozen=True)
class CommandResult:
    command: tuple[str, ...]
    returncode: int
    stdout: str
    stderr: str


class AdbError(RuntimeError):
    pass


class _SubprocessRunner:
    def run(self, command: list[str], timeout: float | None = None) -> CommandResult:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return CommandResult(
            command=tuple(command),
            returncode=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )


class _DryRunRunner:
    def __init__(self) -> None:
        self.commands: list[tuple[str, ...]] = []

    def run(self, command: list[str], timeout: float | None = None) -> CommandResult:
        del timeout
        recorded = tuple(command)
        self.commands.append(recorded)
        return CommandResult(
            command=recorded,
            returncode=0,
            stdout="",
            stderr="",
        )


class AdbClient:
    def __init__(self, binary: str = "adb", serial: str = "", dry_run: bool = False) -> None:
        self.binary = binary
        self.serial = serial.strip()
        self.runner = _DryRunRunner() if dry_run else _SubprocessRunner()

    def build_command(self, *args: str) -> list[str]:
        command = [self.binary]
        if self.serial:
            command.extend(["-s", self.serial])
        command.extend(args)
        return command

    def run(self, *args: str, timeout: float | None = None) -> CommandResult:
        return self.runner.run(self.build_command(*args), timeout=timeout)

    def ensure_available(self) -> CommandResult:
        result = self.run("version")
        if result.returncode != 0:
            raise AdbError(result.stderr or "adb is not available")
        return result

    def list_devices(self) -> list[DeviceInfo]:
        result = self.run("devices", "-l")
        if result.returncode != 0:
            raise AdbError(result.stderr or "failed to list adb devices")

        devices: list[DeviceInfo] = []
        for line in result.stdout.splitlines():
            line = line.strip()
            if not line or line.startswith("List of devices attached"):
                continue
            parts = line.split()
            serial = parts[0]
            state = parts[1] if len(parts) > 1 else "unknown"
            details = " ".join(parts[2:]) if len(parts) > 2 else ""
            devices.append(DeviceInfo(serial=serial, state=state, details=details))
        return devices

    def shell(self, *args: str, timeout: float | None = None) -> CommandResult:
        return self.run("shell", *args, timeout=timeout)

    def launch_app(self, package_name: str, activity: str) -> CommandResult:
        return self.shell("am", "start", "-n", f"{package_name}/{activity}")

    def force_stop(self, package_name: str) -> CommandResult:
        return self.shell("am", "force-stop", package_name)

    def input_text(self, text: str) -> CommandResult:
        escaped = text.replace(" ", "%s")
        return self.shell("input", "text", escaped)

    def keyevent(self, keycode: str) -> CommandResult:
        return self.shell("input", "keyevent", keycode)

    def tap(self, x: int, y: int) -> CommandResult:
        return self.shell("input", "tap", str(x), str(y))

    def screencap(self, remote_path: str, local_path: Path | None = None) -> tuple[CommandResult, CommandResult | None]:
        capture = self.shell("screencap", "-p", remote_path)
        pull = None
        if local_path is not None:
            pull = self.run("pull", remote_path, str(local_path))
        return capture, pull

    def screenrecord(self, remote_path: str, seconds: int) -> CommandResult:
        return self.shell("screenrecord", "--time-limit", str(seconds), remote_path)

    def dump_ui(self, remote_path: str) -> CommandResult:
        return self.shell("uiautomator", "dump", remote_path)

    def logcat_dump(self, lines: int = 2000) -> CommandResult:
        return self.shell("logcat", "-d", "-v", "time", f"-t", str(lines))
