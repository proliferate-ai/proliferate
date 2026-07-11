"""Function-invocation dispatch — the NON-MCP gateway branch (Part II §1, §11).

An invocation is a user-authored HTTP request our server makes on the agent's
behalf. The MCP outbound path (``mcp_remote``) is protocol-shaped end-to-end and
can't carry a raw URL + method + headers, so dispatch here is modeled on the
poller's ``fetch_poll_page``: decrypt the Fernet headers blob, then a raw httpx
request. ``integration_gateway.service.call_provider_tool`` branches to
``call_invocation`` for the reserved ``functions`` namespace AFTER the shared
two-layer scope check has authorized ``(functions, <name>)``.

Server-side safety guarantees (PROPOSED, standard posture — flag if any bites a
real use case):

* SSRF guard — the host must resolve only to public addresses. Private,
  loopback, link-local (incl. the 169.254.169.254 cloud metadata endpoint),
  reserved, multicast, CGNAT (100.64.0.0/10 / Tailscale) and NAT64 ranges are
  denied (v4-in-v6 encodings are unwrapped first), as is any non-http(s) scheme
  or a URL carrying userinfo. The guard returns the ONE vetted IP the dispatch
  PINS to, so httpx can't re-resolve the name to an internal address after the
  check (DNS-rebinding TOCTOU); TLS SNI + cert verification still run against the
  original hostname via the ``sni_hostname`` request extension.
* No cross-host redirects — ``follow_redirects=False`` (a redirect would defeat
  the pre-flight SSRF check by bouncing to an internal host).
* Response size cap enforced WHILE streaming (abort the moment it's crossed, no
  full buffering) + an outer wall-clock deadline so a slow-drip endpoint can't
  hold the connection open indefinitely.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import socket  # noqa: F401 — re-exported so tests can monkeypatch functions.socket.getaddrinfo
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

import httpx
import jsonschema
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    FUNCTION_INVOCATION_HTTP_TIMEOUT_SECONDS,
    FUNCTION_INVOCATION_MAX_RESPONSE_BYTES,
)
from proliferate.db.store import function_invocations as invocations_store
from proliferate.db.store.function_invocations import FunctionInvocationRecord
from proliferate.server.cloud import net_guard
from proliferate.server.cloud.errors import CloudApiError

# The SSRF classification + resolve-and-pin logic is shared with the workflow
# poll/init probes (server/proliferate/server/cloud/net_guard.py). Kept as thin
# re-exports here so this module's public surface (and its tests) is unchanged.
IpAddress = net_guard.IpAddress
_EXTRA_DENIED_NETWORKS = net_guard.EXTRA_DENIED_NETWORKS
_unwrap_ip = net_guard.unwrap_ip
_is_blocked_ip = net_guard.is_blocked_ip


class InvocationSafetyError(CloudApiError):
    """A request the SSRF/safety guard refuses to make. 400 — agent-readable, an
    enumerated denial (never a 500), and NO outbound request is issued."""

    def __init__(self, message: str) -> None:
        super().__init__("function_invocation_blocked", message, status_code=400)


def _guard_endpoint_or_raise(url: str) -> str:
    """SSRF pre-flight: reject non-http(s), userinfo, and hosts that resolve to any
    non-public address. Returns the ONE vetted IP literal the dispatch must pin to
    (prefer IPv4), so the connection can't be re-resolved to a different (internal)
    address after this check — the DNS-rebinding TOCTOU. Raises
    ``InvocationSafetyError`` (no outbound call) on any denial. Delegates the pure
    classification/resolution to the shared ``net_guard`` module."""
    try:
        return net_guard.resolve_and_pin(url)
    except net_guard.NetGuardError as exc:
        raise InvocationSafetyError(str(exc)) from None


def validate_args_or_raise(arguments: dict[str, object], args_schema: dict[str, object]) -> None:
    """Validate the agent's call arguments against the invocation's JSON Schema.

    A schema failure is rejected AT THE GATEWAY — no outbound request is made.
    Raises ``CloudApiError`` (400) on an invalid schema or invalid arguments.
    """
    if not args_schema:
        return
    try:
        jsonschema.validate(instance=arguments, schema=args_schema)
    except jsonschema.ValidationError as exc:
        raise CloudApiError(
            "function_invocation_args_invalid",
            f"Arguments do not match the function's args schema: {exc.message}",
            status_code=400,
        ) from None
    except jsonschema.SchemaError as exc:
        raise CloudApiError(
            "function_invocation_schema_invalid",
            f"The function's args schema is itself invalid: {exc.message}",
            status_code=400,
        ) from None


async def call_invocation(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    name: str,
    arguments: dict[str, object],
) -> dict[str, object]:
    """Resolve, validate, safety-check, and dispatch one invocation.

    Order matters for the deny-path guarantees: args validation and the SSRF
    pre-flight both run BEFORE any outbound request, so a rejected call issues
    zero upstream traffic.
    """
    invocation = await invocations_store.get_by_name(db, owner_user_id=owner_user_id, name=name)
    if invocation is None:
        raise CloudApiError(
            "function_invocation_not_found",
            f"No function invocation named '{name}'.",
            status_code=404,
        )

    # (a) args-schema validation — rejected here means no outbound call.
    validate_args_or_raise(arguments, invocation.args_schema_json)

    # SSRF pre-flight — rejected here means no outbound call. Returns the vetted
    # IP the dispatch pins to (closes the DNS-rebinding TOCTOU: httpx must connect
    # to exactly this address, never a re-resolution).
    pinned_ip = _guard_endpoint_or_raise(invocation.endpoint_url)

    headers = await invocations_store.decrypt_headers(db, owner_user_id=owner_user_id, name=name)
    return await _dispatch(invocation, arguments=arguments, headers=headers, pinned_ip=pinned_ip)


def _too_large_error() -> CloudApiError:
    return CloudApiError(
        "function_invocation_response_too_large",
        f"Function invocation response exceeded {FUNCTION_INVOCATION_MAX_RESPONSE_BYTES} bytes.",
        status_code=502,
    )


def _authority(host: str, port: int | None) -> str:
    """Build a URL/Host authority, bracketing IPv6 literals."""
    try:
        is_v6 = isinstance(ipaddress.ip_address(host), ipaddress.IPv6Address)
    except ValueError:
        is_v6 = False
    literal = f"[{host}]" if is_v6 else host
    return f"{literal}:{port}" if port else literal


async def _dispatch(
    invocation: FunctionInvocationRecord,
    *,
    arguments: dict[str, object],
    headers: dict[str, str],
    pinned_ip: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, object]:
    method = invocation.method.lower()
    # GET/DELETE carry args in the query string; body methods carry a JSON body.
    query = arguments if method in ("get", "delete") else None
    json_body = arguments if method in ("post", "patch", "put") else None

    parts = urlsplit(invocation.endpoint_url)
    original_host = parts.hostname or ""
    # Pin the connection target to the vetted IP so httpx can't re-resolve the
    # hostname to a different (internal) address between the guard and the request.
    # TLS SNI + certificate verification still run against the ORIGINAL hostname
    # via the sni_hostname request extension, and the Host header carries it so
    # vhosts route correctly. TLS verification is NOT weakened.
    pinned_url = urlunsplit(
        (parts.scheme, _authority(pinned_ip, parts.port), parts.path, parts.query, "")
    )
    request_headers = dict(headers or {})
    request_headers["Host"] = _authority(original_host, parts.port)
    extensions = {"sni_hostname": original_host} if parts.scheme == "https" else {}

    body = bytearray()
    try:
        # Outer wall-clock guard: the httpx per-op timeout is per read/connect, so
        # a slow-drip endpoint could hold the connection open indefinitely across
        # many sub-timeout reads. Bound total time to 2x the per-op budget.
        async with asyncio.timeout(FUNCTION_INVOCATION_HTTP_TIMEOUT_SECONDS * 2):
            async with httpx.AsyncClient(
                timeout=FUNCTION_INVOCATION_HTTP_TIMEOUT_SECONDS,
                follow_redirects=False,  # a cross-host redirect would bypass the SSRF guard
                transport=transport,
            ) as client:
                # Stream + cap while iterating (mirrors poller.fetch_poll_page): abort
                # the moment the cap is crossed instead of buffering the whole body.
                async with client.stream(
                    method.upper(),
                    pinned_url,
                    params=query,
                    json=json_body,
                    headers=request_headers,
                    extensions=extensions,
                ) as response:
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > FUNCTION_INVOCATION_MAX_RESPONSE_BYTES:
                            raise _too_large_error()
                    status_code = response.status_code
                    is_success = response.is_success
    except CloudApiError:
        raise  # the too-large denial — propagate as-is
    except (httpx.HTTPError, TimeoutError) as exc:
        raise CloudApiError(
            "function_invocation_request_failed",
            f"Function invocation request failed: {exc.__class__.__name__}: {exc}",
            status_code=502,
        ) from None

    text = bytes(body).decode("utf-8", errors="replace")
    parsed: object
    try:
        parsed = json.loads(text) if text else None
    except json.JSONDecodeError:
        parsed = text
    payload = {
        "status": status_code,
        "ok": is_success,
        "body": parsed,
    }
    return {
        "content": [{"type": "text", "text": json.dumps(payload, separators=(",", ":"))}],
        "structuredContent": payload,
        "isError": not is_success,
    }
