from __future__ import annotations

from io import BytesIO
from unittest.mock import patch

from autotest.service_probe import ServiceProbe, classify_issue
from autotest.ui_dump import read_uiautomator_texts


class _FakeResponse:
    def __init__(self, status: int, body: bytes) -> None:
        self.status = status
        self._body = BytesIO(body)

    def read(self, size: int = -1) -> bytes:
        return self._body.read(size)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_probe_success_reads_healthz():
    with patch("autotest.service_probe.request.urlopen", return_value=_FakeResponse(200, b"ok")):
        result = ServiceProbe("http://127.0.0.1:3100").probe()

    assert result.ok is True
    assert result.status_code == 200
    assert result.body_preview == "ok"


def test_classify_issue_maps_websocket_error_to_handshake():
    lines = [
        "socket.error -> io.socket.engineio.client.engineIOException:websocketerror",
        "room.joined session=abc",
    ]

    assert classify_issue(lines, probe_ok=True) == "websocket_handshake"
    assert classify_issue(lines, probe_ok=False) == "network_or_service_unreachable"


def test_read_uiautomator_texts_extracts_visible_status_messages(tmp_path):
    xml_file = tmp_path / "window.xml"
    xml_file.write_text(
        """
<hierarchy>
  <node text="Room r_15620bf13a30 created." />
  <node text="Event Logs" />
  <node text="create_room -> r_15620bf13a30" />
</hierarchy>
""".strip(),
        encoding="utf-8",
    )

    texts = read_uiautomator_texts(xml_file)

    assert "Room r_15620bf13a30 created." in texts
    assert "create_room -> r_15620bf13a30" in texts
