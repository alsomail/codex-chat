from __future__ import annotations

from pathlib import Path

from autotest.capture import build_capture_plan, format_filter_expr


def test_build_capture_plan_uses_stable_file_names(tmp_path):
    plan = build_capture_plan(tmp_path, "req004 / real device")

    assert plan.logcat_file.name == "req004___real_device.logcat.txt"
    assert plan.screenshot_file.suffix == ".png"
    assert plan.screenrecord_file.suffix == ".mp4"
    assert plan.ui_dump_file.suffix == ".xml"


def test_format_filter_expr_defaults_to_req004_markers():
    assert "socket.error" in format_filter_expr([])
