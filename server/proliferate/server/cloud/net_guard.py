"""Shared SSRF pre-flight: classify an address + resolve-and-pin a URL's host.

Extracted from ``integration_gateway.functions`` (landed by track 1b) so every
server-side "make an HTTP request to a user-authored URL" call site — the
function-invocation dispatch AND the workflow poll/init probes — shares ONE
classification + resolve-and-pin implementation instead of forking it.

The guard rejects any URL that is not http(s), embeds userinfo, or whose host
resolves to a non-public address. Private, loopback, link-local (incl. the
169.254.169.254 cloud metadata endpoint), reserved, multicast, unspecified,
CGNAT (100.64.0.0/10 / Tailscale) and NAT64 ranges are denied — v4-in-v6
encodings are unwrapped first so a private v4 can't dodge classification by
being wrapped in a v6 literal. A name that resolves to a MIX of public and
private addresses is refused wholesale (DNS-rebinding defense).

``resolve_and_pin`` returns the ONE vetted IP literal a caller should PIN its
connection to, so httpx can't re-resolve the hostname to a different (internal)
address after the check (the DNS-rebinding TOCTOU).

This module is pure network logic — it holds no app policy. Callers decide when
to bypass it (e.g. local/self-host ``settings.debug`` dev pointing at localhost).
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit

IpAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

# Ranges the stdlib ``is_*`` classifiers do NOT flag but that we still refuse.
# 100.64.0.0/10 is RFC 6598 shared/CGNAT space — also Tailscale's default tailnet
# range — so an endpoint on a shared-CGNAT or tailnet host would otherwise slip
# past ``is_private``. NAT64's well-known prefix is denied wholesale (its embedded
# v4 is unwrapped below, but the prefix itself has no legitimate outbound use).
EXTRA_DENIED_NETWORKS: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...] = (
    ipaddress.ip_network("100.64.0.0/10"),  # RFC 6598 CGNAT / Tailscale
    ipaddress.ip_network("64:ff9b::/96"),  # NAT64 well-known prefix (RFC 6052)
)


class NetGuardError(Exception):
    """A URL/host the SSRF guard refuses. Callers map this to their own error
    (a 400 for API surfaces; a recorded poll error for the runtime poller). No
    outbound request should be issued once this is raised."""


def unwrap_ip(ip: IpAddress) -> IpAddress:
    """Collapse IPv4-in-IPv6 encodings to the underlying v4 so a private v4 can't
    dodge classification by being wrapped in a v6 literal — ``::ffff:10.0.0.0``
    (IPv4-mapped), ``2002:V4::`` (6to4), ``64:ff9b::V4`` (NAT64)."""
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return ip.ipv4_mapped
        if ip.sixtofour is not None:
            return ip.sixtofour
        if ip in ipaddress.ip_network("64:ff9b::/96"):
            return ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    return ip


def is_blocked_ip(ip: IpAddress) -> bool:
    """True if an address is non-public per the stdlib classifiers OR falls in one
    of our extra denied networks (checked on the unwrapped address)."""
    effective = unwrap_ip(ip)
    if (
        effective.is_private
        or effective.is_loopback
        or effective.is_link_local
        or effective.is_reserved
        or effective.is_multicast
        or effective.is_unspecified
    ):
        return True
    # ``addr in net`` is False across IP versions, so mixed-version checks are safe.
    return any(effective in net or ip in net for net in EXTRA_DENIED_NETWORKS)


def resolve_and_pin(url: str) -> str:
    """SSRF pre-flight: reject non-http(s), userinfo, and hosts that resolve to any
    non-public address. Returns the ONE vetted IP literal the caller must pin to
    (prefer IPv4), so the connection can't be re-resolved to a different (internal)
    address after this check — the DNS-rebinding TOCTOU. Raises ``NetGuardError``
    (no outbound call) on any denial."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise NetGuardError("Endpoint must be an http(s) URL.")
    if parts.username or parts.password:
        raise NetGuardError("Endpoint URL must not embed credentials.")
    host = parts.hostname
    if not host:
        raise NetGuardError("Endpoint URL has no host.")
    # Resolve to every candidate address and reject if ANY is non-public — a name
    # that resolves to a mix (DNS rebinding) is refused wholesale.
    try:
        infos = socket.getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise NetGuardError(f"Endpoint host did not resolve: {exc}") from None
    addresses = {info[4][0] for info in infos}
    if not addresses:
        raise NetGuardError("Endpoint host did not resolve.")
    vetted: list[IpAddress] = []
    for raw in addresses:
        ip = ipaddress.ip_address(raw.split("%", 1)[0])  # strip any zone id
        if is_blocked_ip(ip):
            raise NetGuardError(
                "Endpoint resolves to a private, loopback, link-local, reserved, or "
                "otherwise disallowed (CGNAT/NAT64) address, which is not allowed."
            )
        vetted.append(ip)
    # Pin to ONE vetted address; prefer IPv4 for URL-literal simplicity.
    vetted.sort(key=lambda a: a.version)
    return str(vetted[0])
