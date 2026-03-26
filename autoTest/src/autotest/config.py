from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import tomllib


@dataclass(frozen=True)
class AdbSettings:
    binary: str = "adb"
    serial: str = ""


@dataclass(frozen=True)
class AppSettings:
    package_name: str = "com.chatroom.app"
    launcher_activity: str = "com.chatroom.app.login.LoginActivity"
    login_phone: str = "+971500009001"
    login_otp: str = "123456"
    base_url: str = "http://127.0.0.1:3100"
    health_path: str = "/healthz"
    room_id: str = ""
    manual_mode: bool = True


@dataclass(frozen=True)
class CaptureSettings:
    artifact_dir: str = "artifacts"
    logcat_buffer_lines: int = 2000
    record_seconds: int = 30


@dataclass(frozen=True)
class FlowSettings:
    wait_seconds_after_launch: int = 3
    wait_seconds_after_login: int = 3
    wait_seconds_after_reconnect: int = 5


@dataclass(frozen=True)
class AutoTestConfig:
    adb: AdbSettings
    app: AppSettings
    capture: CaptureSettings
    flow: FlowSettings


def load_config(path: str | Path) -> AutoTestConfig:
    config_path = Path(path)
    raw = tomllib.loads(config_path.read_text(encoding="utf-8"))
    adb = raw.get("adb", {})
    app = raw.get("app", {})
    capture = raw.get("capture", {})
    flow = raw.get("flow", {})
    return AutoTestConfig(
        adb=AdbSettings(
            binary=str(adb.get("binary", "adb")),
            serial=str(adb.get("serial", "")).strip(),
        ),
        app=AppSettings(
            package_name=str(app.get("package_name", "com.chatroom.app")),
            launcher_activity=str(app.get("launcher_activity", "com.chatroom.app.login.LoginActivity")),
            login_phone=str(app.get("login_phone", "+971500009001")),
            login_otp=str(app.get("login_otp", "123456")),
            base_url=str(app.get("base_url", "http://127.0.0.1:3100")),
            health_path=str(app.get("health_path", "/healthz")),
            room_id=str(app.get("room_id", "")),
            manual_mode=bool(app.get("manual_mode", True)),
        ),
        capture=CaptureSettings(
            artifact_dir=str(capture.get("artifact_dir", "artifacts")),
            logcat_buffer_lines=int(capture.get("logcat_buffer_lines", 2000)),
            record_seconds=int(capture.get("record_seconds", 30)),
        ),
        flow=FlowSettings(
            wait_seconds_after_launch=int(flow.get("wait_seconds_after_launch", 3)),
            wait_seconds_after_login=int(flow.get("wait_seconds_after_login", 3)),
            wait_seconds_after_reconnect=int(flow.get("wait_seconds_after_reconnect", 5)),
        ),
    )
