from __future__ import annotations

from autotest.adb import AdbClient
from autotest.config import load_config
from autotest.req004_flow import Req004Flow


def test_req004_flow_builds_manual_checkpoints(tmp_path):
    config_path = tmp_path / "req004.toml"
    config_path.write_text(
        """
[adb]
binary = "adb"
serial = ""

[app]
base_url = "http://127.0.0.1:3100"

[capture]
artifact_dir = "artifacts"
""".strip(),
        encoding="utf-8",
    )
    config = load_config(config_path)
    flow = Req004Flow(config=config, adb=AdbClient(dry_run=True), artifact_root=tmp_path)

    plan = flow.build_plan()
    assert any(step.manual_checkpoint for step in plan)
    assert any(step.name == "launch-app" for step in plan)


def test_req004_flow_dry_run_returns_diagnostic(tmp_path):
    config_path = tmp_path / "req004.toml"
    config_path.write_text(
        """
[adb]
binary = "adb"

[app]
base_url = "http://127.0.0.1:1"
health_path = "/healthz"

[capture]
artifact_dir = "artifacts"
""".strip(),
        encoding="utf-8",
    )
    config = load_config(config_path)
    flow = Req004Flow(config=config, adb=AdbClient(dry_run=True), artifact_root=tmp_path)

    report = flow.run(dry_run=True)

    assert report.mode == "dry-run"
    assert report.diagnosis == "dry_run_only"
    assert any(step.name == "adb-version" for step in report.steps)
