from __future__ import annotations

from autotest.config import load_config


def test_load_config_reads_req004_defaults(tmp_path):
    config_file = tmp_path / "req004.toml"
    config_file.write_text(
        """
[adb]
binary = "adb"
serial = "emulator-5554"

[app]
base_url = "http://127.0.0.1:3100"
manual_mode = false

[capture]
artifact_dir = "artifacts"

[flow]
wait_seconds_after_launch = 2
""".strip(),
        encoding="utf-8",
    )

    config = load_config(config_file)

    assert config.adb.binary == "adb"
    assert config.adb.serial == "emulator-5554"
    assert config.app.base_url == "http://127.0.0.1:3100"
    assert config.app.manual_mode is False
    assert config.capture.artifact_dir == "artifacts"
    assert config.flow.wait_seconds_after_launch == 2
