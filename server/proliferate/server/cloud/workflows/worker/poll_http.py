"""DB-free SSRF guard + auth-decrypt adapter for poll-endpoint fetches (§10.3).

Shared by three callers that all issue the SAME kind of outbound request to an
operator-supplied poll/init endpoint: the trigger create/update service probe
(``triggers.py``), the legacy poll loop (``poller.py``, kept until WS4c), and
the WS4b beat-driven poll worker (``worker/polls.py``). Nothing here opens a DB
session or holds one open — the point of this module is that the SSRF
preflight and the raw HTTP fetch (``poller.fetch_poll_page``, which stays in
``poller.py`` — see its docstring) can run with zero transaction in scope,
which is exactly what lets the WS4b poll worker fetch a page without holding a
trigger row lock or a database transaction across network I/O.
"""

from __future__ import annotations

from proliferate.config import settings
from proliferate.server.cloud import net_guard
from proliferate.server.cloud.errors import CloudApiError
from proliferate.utils.crypto import decrypt_text


def guard_poll_endpoint(url: str) -> None:
    """SSRF pre-flight for every server-issued poll/init request (§11 risk profile).

    A cloud-hosted server GETting an operator-supplied URL is an SSRF surface —
    the same one the function-invocation dispatch faces — so it goes through the
    SAME shared guard (``net_guard.resolve_and_pin``): private, loopback,
    link-local (incl. 169.254.169.254 metadata), reserved, multicast, CGNAT
    (100.64/10) and NAT64 hosts are refused before any packet leaves. Applied on
    the PROBE path (trigger create/update re-validation + the stateless
    ``/poll/inspect`` endpoint), the legacy poller's fetch, and the WS4b beat
    worker's fetch.

    Bypassed under ``settings.debug`` (local/self-host dev) so a developer can
    point a poll trigger at ``http://localhost`` feeds. Tests flip ``debug`` off to
    exercise the guard. Raises ``CloudApiError('poll_endpoint_blocked')`` — no
    outbound request — on any denial.
    """

    if settings.debug:
        return
    try:
        net_guard.resolve_and_pin(url)
    except net_guard.NetGuardError as exc:
        raise CloudApiError("poll_endpoint_blocked", str(exc), status_code=400) from None


def decrypt_poll_auth_header(
    auth_header: str | None, auth_ciphertext: str | None
) -> tuple[str, str] | None:
    """Return ``(header name, plaintext value)`` for the request, or ``None``.

    The Fernet-encrypted header value is decrypted here — the one narrow place
    the plaintext secret exists outside the DB — and only ever held in-process
    for the immediate HTTP call.
    """

    if not auth_header or not auth_ciphertext:
        return None
    return auth_header, decrypt_text(auth_ciphertext)
