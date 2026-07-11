"""Shared SSRF pre-flight: classify an address + resolve-and-pin a URL's host.

Extracted from ``integration_gateway.functions`` (landed by track 1b) so every
server-side "make an HTTP request to a user-authored URL" call site — the
function-invocation dispatch AND the workflow poll/init probes — shares ONE
classification + resolve-and-pin implementation instead of forking it.

The guard rejects any URL that is not http(s), embeds userinfo, or whose host
resolves to a non-public address. Private, loopback, link-local (incl. the
169.254.169.254 cloud metadata endpoint), reserved, multicast, unspecified,
CGNAT (100.64.0.0/10 / Tailscale), NAT64, Teredo, and 6to4 ranges are denied —
v4-in-v6 encodings are unwrapped first so a private v4 can't dodge
classification by being wrapped in a v6 literal. A name that resolves to a MIX
of public and private addresses is refused wholesale (DNS-rebinding defense).

``resolve_and_pin_endpoint`` returns a typed ``VettedEndpoint`` — the ONE vetted
IP literal a caller PINS its socket to, plus the original scheme/host/port the
caller must keep for the HTTP Host header and TLS SNI/certificate validation. A
caller that pins the socket to the vetted IP closes the DNS-rebinding TOCTOU:
httpx can't re-resolve the hostname to a different (internal) address after the
check.

Network AUTHORITY is an explicit injected policy, never an ambient config/env
switch. ``PUBLIC_ONLY`` (the default everywhere in production) permits only
public addresses. ``LOOPBACK_TEST`` additionally permits ``127.0.0.0/8`` and
``::1`` and NOTHING else — it exists solely so unit/adversarial tests (or a
test-owned dependency bootstrap) can reach a controllable local server without
opening any other private/reserved range. There is deliberately no
``ALLOW_PRIVATE``/``LOCAL_DEV`` environment escape hatch: telemetry/debug mode
must never grant network authority.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import cast
from urllib.parse import urlsplit

IpAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

# Ranges the stdlib ``is_*`` classifiers do NOT reliably flag but that we still
# refuse. 100.64.0.0/10 is RFC 6598 shared/CGNAT space — also Tailscale's default
# tailnet range — so an endpoint on a shared-CGNAT or tailnet host would otherwise
# slip past ``is_private``. NAT64's well-known prefix is denied wholesale (its
# embedded v4 is unwrapped below, but the prefix itself has no legitimate outbound
# use). Teredo (2001::/32, RFC 4380) and 6to4 (2002::/16 plus the retired
# 192.88.99.0/24 relay anycast) tunnel IPv4 through address families whose stdlib
# classification has changed across Python releases; all are denied wholesale.
EXTRA_DENIED_NETWORKS: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...] = (
    ipaddress.ip_network("100.64.0.0/10"),  # RFC 6598 CGNAT / Tailscale
    ipaddress.ip_network("192.88.99.0/24"),  # retired 6to4 relay anycast (RFC 7526)
    ipaddress.ip_network("64:ff9b::/96"),  # NAT64 well-known prefix (RFC 6052)
    ipaddress.ip_network("2001::/32"),  # Teredo tunneling (RFC 4380)
    ipaddress.ip_network("2002::/16"),  # 6to4 tunneling (deprecated by RFC 7526)
)


@dataclass(frozen=True)
class NetworkPolicy:
    """Which non-public address ranges, if any, an outbound guard tolerates.

    An explicit, immutable object passed by the CALLER — never derived from an
    environment variable, ``settings.debug``, or telemetry mode. Production always
    passes ``PUBLIC_ONLY``; only test code passes ``LOOPBACK_TEST``.
    """

    name: str
    # The ONLY relaxation ``LOOPBACK_TEST`` grants: 127.0.0.0/8 and ::1. Every other
    # private/link-local/reserved/CGNAT/NAT64/Teredo/6to4 range stays denied even then.
    allow_loopback: bool = False


PUBLIC_ONLY = NetworkPolicy(name="public_only")
LOOPBACK_TEST = NetworkPolicy(name="loopback_test", allow_loopback=True)

# Isolate potentially blocking libc DNS from the event loop's shared executor.
# Cancellation cannot stop an in-flight getaddrinfo call, so the worker count is
# deliberately bounded; queued cancelled futures are discarded by the executor.
_DNS_EXECUTOR = ThreadPoolExecutor(max_workers=8, thread_name_prefix="outbound-dns")


@dataclass(frozen=True)
class VettedEndpoint:
    """The result of a passing ``resolve_and_pin_endpoint``: connect the socket to
    ``pinned_ip`` while keeping ``host`` for the HTTP Host header and TLS SNI /
    certificate validation. Revalidate (re-call the guard) for every new
    connection — a vetted endpoint is never cached across requests."""

    scheme: str
    host: str
    port: int | None
    pinned_ip: str


class NetGuardError(Exception):
    """A URL/host the SSRF guard refuses. Callers map this to their own error
    (a 400 for API surfaces; a recorded poll error for the runtime poller). No
    outbound request should be issued once this is raised."""


def unwrap_ip(ip: IpAddress) -> IpAddress:
    """Collapse IPv4-in-IPv6 encodings to the underlying v4 so a private v4 can't
    dodge classification by being wrapped in a v6 literal — ``::ffff:10.0.0.0``
    (IPv4-mapped), ``2002:V4::`` (6to4), ``64:ff9b::V4`` (NAT64), Teredo's embedded
    client v4 (``2001::/32``)."""
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return ip.ipv4_mapped
        if ip.sixtofour is not None:
            return ip.sixtofour
        if ip in ipaddress.ip_network("64:ff9b::/96"):
            return ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
        teredo = ip.teredo
        if teredo is not None:
            # teredo = (server_v4, client_v4); the client is the tunnelled host.
            return teredo[1]
    return ip


def is_blocked_ip(ip: IpAddress, *, policy: NetworkPolicy = PUBLIC_ONLY) -> bool:
    """True if an address is non-public per the stdlib classifiers OR falls in one
    of our extra denied networks (checked on the unwrapped address).

    Loopback (127.0.0.0/8, ::1) is the ONE range a non-default policy may permit
    (``LOOPBACK_TEST``); every other private/reserved range is denied regardless of
    policy. The original AND unwrapped address are both checked so a v4-in-v6
    wrapper can't smuggle a denied literal past the extra-network membership test."""
    effective = unwrap_ip(ip)
    if effective.is_loopback or ip.is_loopback:
        # Loopback is allowed ONLY under an explicit loopback-permitting policy.
        return not policy.allow_loopback
    # Fail closed on every address Python does not classify as globally routable,
    # checking BOTH the wrapper and its unwrapped IPv4. The explicit properties
    # retain readable intent and protect us if a future stdlib changes is_global's
    # relationship to one of them.
    if (
        not effective.is_global
        or not ip.is_global
        or effective.is_private
        or ip.is_private
        or effective.is_link_local
        or ip.is_link_local
        or effective.is_reserved
        or ip.is_reserved
        or effective.is_multicast
        or ip.is_multicast
        or effective.is_unspecified
        or ip.is_unspecified
    ):
        return True
    # ``addr in net`` is False across IP versions, so mixed-version checks are safe.
    return any(effective in net or ip in net for net in EXTRA_DENIED_NETWORKS)


def _parse_endpoint(url: str) -> tuple[str, str, int | None]:
    """Shared scheme/host/port validation for both the sync and async resolvers.
    Returns ``(scheme, host, port)``. Raises ``NetGuardError`` on a non-http(s)
    scheme, embedded userinfo, a missing host, or a malformed port (``.port`` is a
    lazy property that raises a bare ``ValueError`` on a non-numeric or
    out-of-range port — turned into the same structured denial as any other
    unparseable endpoint, never left to escape as an unhandled ``ValueError``)."""
    try:
        parts = urlsplit(url)
        username = parts.username
        password = parts.password
        host = parts.hostname
        port = parts.port
    except ValueError as exc:
        raise NetGuardError(f"Endpoint URL is malformed: {exc}") from None
    if parts.scheme not in ("http", "https"):
        raise NetGuardError("Endpoint must be an http(s) URL.")
    if username or password:
        raise NetGuardError("Endpoint URL must not embed credentials.")
    if not host:
        raise NetGuardError("Endpoint URL has no host.")
    if port == 0:
        raise NetGuardError("Endpoint URL port must be between 1 and 65535.")
    return parts.scheme, host, port


def _vet_resolved_addresses(
    infos: Sequence[tuple[object, ...]], *, policy: NetworkPolicy
) -> list[IpAddress]:
    """Reject if ANY candidate address the name resolved to is forbidden by
    ``policy`` — a name that resolves to a MIX of public/private (DNS rebinding)
    is refused wholesale. Returns the vetted addresses, IPv4 first."""
    addresses = {str(cast(tuple[object, ...], info[4])[0]) for info in infos}
    if not addresses:
        raise NetGuardError("Endpoint host did not resolve.")
    vetted: list[IpAddress] = []
    for raw in addresses:
        try:
            ip = ipaddress.ip_address(raw.split("%", 1)[0])  # strip any zone id
        except ValueError:
            raise NetGuardError("Endpoint host resolved to an invalid IP address.") from None
        if is_blocked_ip(ip, policy=policy):
            raise NetGuardError(
                "Endpoint resolves to a private, loopback, link-local, reserved, or "
                "otherwise disallowed (CGNAT/NAT64/Teredo/6to4) address, which is not allowed."
            )
        vetted.append(ip)
    vetted.sort(key=lambda a: a.version)
    return vetted


def resolve_and_pin_endpoint(url: str, *, policy: NetworkPolicy = PUBLIC_ONLY) -> VettedEndpoint:
    """SSRF pre-flight: reject non-http(s), userinfo, and hosts that resolve to any
    address the ``policy`` forbids. Returns a ``VettedEndpoint`` — the ONE vetted IP
    literal the caller must pin to (prefer IPv4) plus the original scheme/host/port
    for the Host header + TLS SNI — so the connection can't be re-resolved to a
    different (internal) address after this check (the DNS-rebinding TOCTOU). Raises
    ``NetGuardError`` (no outbound call) on any denial.

    SYNCHRONOUS — blocks the calling thread on DNS resolution. Kept only for the
    function-invocation dispatch's existing (sync) call site via ``resolve_and_pin``.
    An async caller (the workflow poll/init paths) MUST use
    ``resolve_and_pin_endpoint_async`` instead, so a slow/hung resolver can't block
    the event loop and stays bounded by the caller's absolute deadline."""
    scheme, host, port = _parse_endpoint(url)
    # Resolve to every candidate address and reject if ANY is forbidden — a name
    # that resolves to a mix (DNS rebinding) is refused wholesale.
    try:
        infos = socket.getaddrinfo(host, port or (443 if scheme == "https" else 80))
    except (OSError, UnicodeError) as exc:
        raise NetGuardError(f"Endpoint host did not resolve: {exc}") from None
    vetted = _vet_resolved_addresses(infos, policy=policy)
    return VettedEndpoint(scheme=scheme, host=host, port=port, pinned_ip=str(vetted[0]))


async def resolve_and_pin_endpoint_async(
    url: str, *, policy: NetworkPolicy = PUBLIC_ONLY
) -> VettedEndpoint:
    """Same contract as ``resolve_and_pin_endpoint``, but performs DNS resolution
    OFF the event loop (``loop.run_in_executor``) instead of blocking it with a
    synchronous ``socket.getaddrinfo`` call. A slow or hung resolver therefore
    can't stall every other coroutine on this worker, and — because it's awaited —
    the call is bounded by whatever ``asyncio.timeout`` the caller wraps it in
    (the workflow poll/init paths wrap the guard call and the fetch together under
    one absolute deadline). The module-level ``socket.getaddrinfo`` reference is
    passed explicitly (not looked up via ``loop.getaddrinfo``, which would resolve
    the stdlib's own binding) so tests can monkeypatch ``net_guard.socket.getaddrinfo``
    the same way the sync path is tested."""
    scheme, host, port = _parse_endpoint(url)
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.run_in_executor(
            _DNS_EXECUTOR,
            socket.getaddrinfo,
            host,
            port or (443 if scheme == "https" else 80),
        )
    except (OSError, UnicodeError) as exc:
        raise NetGuardError(f"Endpoint host did not resolve: {exc}") from None
    vetted = _vet_resolved_addresses(infos, policy=policy)
    return VettedEndpoint(scheme=scheme, host=host, port=port, pinned_ip=str(vetted[0]))


def resolve_and_pin(url: str, *, policy: NetworkPolicy = PUBLIC_ONLY) -> str:
    """Backward-compatible shim: the vetted pinned IP literal only. The
    function-invocation dispatch pins to this. New callers that also need to force
    the Host/SNI to the original hostname should use ``resolve_and_pin_endpoint``
    (sync) or ``resolve_and_pin_endpoint_async`` (async, event-loop-safe)."""
    return resolve_and_pin_endpoint(url, policy=policy).pinned_ip
