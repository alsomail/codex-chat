from __future__ import annotations

from autotest.adb import AdbClient


def test_adb_builds_serialized_commands():
    adb = AdbClient(serial="emulator-5554", dry_run=True)
    command = adb.build_command("shell", "am", "start", "-n", "com.chatroom.app/.MainActivity")

    assert command[:3] == ["adb", "-s", "emulator-5554"]
    assert command[-2:] == ["-n", "com.chatroom.app/.MainActivity"]
