from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from urllib import error, request
from urllib.parse import urljoin

from .models import ProbeResult


@dataclass(frozen=True)
class ServiceProbe:
    base_url: str
    health_path: str = "/healthz"
    timeout_seconds: float = 3.0

    def probe(self) -> ProbeResult:
        url = urljoin(self.base_url.rstrip("/") + "/", self.health_path.lstrip("/"))
        start = perf_counter()
        try:
            with request.urlopen(url, timeout=self.timeout_seconds) as response:
                body = response.read(256).decode("utf-8", errors="replace")
                elapsed_ms = (perf_counter() - start) * 1000
                return ProbeResult(
                    url=url,
                    ok=200 <= response.status < 400,
                    status_code=response.status,
                    elapsed_ms=elapsed_ms,
                    body_preview=body.strip(),
                )
        except error.HTTPError as exc:
            elapsed_ms = (perf_counter() - start) * 1000
            body = exc.read(256).decode("utf-8", errors="replace") if hasattr(exc, "read") else ""
            return ProbeResult(
                url=url,
                ok=False,
                status_code=exc.code,
                elapsed_ms=elapsed_ms,
                body_preview=body.strip(),
                error=str(exc),
            )
        except OSError as exc:
            elapsed_ms = (perf_counter() - start) * 1000
            return ProbeResult(
                url=url,
                ok=False,
                status_code=None,
                elapsed_ms=elapsed_ms,
                error=str(exc),
            )


def classify_issue(log_lines: list[str], probe_ok: bool) -> str:
    normalized = "\n".join(log_lines)
    if "socket.error -> io.socket.engineio.client.engineIOException:websocketerror" in normalized:
        return "websocket_handshake" if probe_ok else "network_or_service_unreachable"
    if "session.reconnected requires rejoin" in normalized or "RECON_003" in normalized:
        return "session_recovery"
    if "room.recover_hint" in normalized or "RECON_005" in normalized:
        return "seat_recovery"
    if "onDisconnected" in normalized and "reconnect" in normalized:
        return "state_machine_transition"
    return "unknown"
