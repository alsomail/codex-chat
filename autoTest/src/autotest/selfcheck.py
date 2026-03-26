from __future__ import annotations

from pathlib import Path
import tempfile

from .adb import AdbClient
from .config import load_config
from .req004_flow import Req004Flow
from .service_probe import classify_issue
from .ui_dump import read_uiautomator_texts


def run_selfcheck() -> list[str]:
    messages: list[str] = []
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        config_file = root / "req004.toml"
        config_file.write_text(
            """
[adb]
binary = "adb"
serial = "emulator-5554"

[app]
base_url = "http://127.0.0.1:3100"
manual_mode = true

[capture]
artifact_dir = "artifacts"

[flow]
wait_seconds_after_launch = 1
""".strip(),
            encoding="utf-8",
        )

        config = load_config(config_file)
        flow = Req004Flow(config=config, adb=AdbClient(dry_run=True), artifact_root=root)
        plan = flow.build_plan()
        report = flow.run(dry_run=True)

        assert config.adb.serial == "emulator-5554"
        assert any(step.manual_checkpoint for step in plan)
        assert report.mode == "dry-run"
        assert report.diagnosis == "dry_run_only"
        assert report.artifact_dir.exists()
        ui_file = root / "ui.xml"
        ui_file.write_text(
            """
<hierarchy>
  <node text="Room r_15620bf13a30 created." />
  <node text="create_room -> r_15620bf13a30" />
</hierarchy>
""".strip(),
            encoding="utf-8",
        )
        assert "Room r_15620bf13a30 created." in read_uiautomator_texts(ui_file)
        assert classify_issue(
            ["socket.error -> io.socket.engineio.client.engineIOException:websocketerror"],
            probe_ok=True,
        ) == "websocket_handshake"

        messages.append(f"selfcheck ok: {len(plan)} steps, {len(report.steps)} recorded results")

    return messages


def main() -> int:
    for line in run_selfcheck():
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
