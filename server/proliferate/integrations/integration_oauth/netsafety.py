"""Outbound-URL safety shared by OAuth discovery and revocation.

Server-side OAuth requests fetch URLs that ultimately derive from user input
(an admin-registered MCP server URL) or from a remote server's own responses
(a ``WWW-Authenticate`` ``resource_metadata`` pointer, published metadata
documents). Every such fetch must be confined to public HTTPS origins so a
hostile value cannot steer the control plane into internal networks or cloud
metadata services (CodeQL py/full-ssrf).

Two layers, matching the revocation module's long-standing rules:

- :func:`parse_public_https_origin` — structural: HTTPS scheme, a hostname,
  no userinfo, no fragment, IDNA-normalizable host.
- :func:`resolve_public_addresses` — behavioral: every address the hostname
  resolves to is globally routable (``ipaddress.is_global`` rejects loopback,
  RFC 1918, link-local — including 169.254.169.254 — and other special
  ranges).

Callers wrap :class:`ValueError` in their own provider-facing error.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit


def parse_public_https_origin(value: str) -> tuple[str, int]:
    """Return ``(idna_hostname, port)`` or raise ``ValueError``."""

    parsed = urlsplit(value)
    port = parsed.port or 443  # ValueError propagates for out-of-range ports
    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise ValueError(f"not a plain public-HTTPS URL: {value!r}")
    hostname = parsed.hostname.rstrip(".").lower()
    try:
        normalized_hostname = hostname.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError(f"hostname is not IDNA-normalizable: {value!r}") from exc
    return normalized_hostname, port


async def resolve_host_addresses(hostname: str, port: int) -> tuple[str, ...]:
    """DNS-resolve ``hostname``; raise ``ValueError`` when it does not resolve."""

    try:
        results = await asyncio.to_thread(
            socket.getaddrinfo,
            hostname,
            port,
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise ValueError(f"hostname does not resolve: {hostname!r}") from exc
    return tuple(str(result[4][0]) for result in results)


async def resolve_public_addresses(hostname: str, port: int) -> tuple[str, ...]:
    """Resolve ``hostname`` and require every address to be globally routable."""

    try:
        direct_address = ipaddress.ip_address(hostname)
    except ValueError:
        addresses = await resolve_host_addresses(hostname, port)
        if not addresses:
            raise ValueError(f"hostname does not resolve: {hostname!r}") from None
        resolved = tuple(ipaddress.ip_address(address) for address in addresses)
    else:
        resolved = (direct_address,)
    if any(not address.is_global for address in resolved):
        raise ValueError(f"host resolves to a non-public address: {hostname!r}")
    return tuple(str(address) for address in resolved)


async def require_public_https_url(value: str) -> None:
    """Raise ``ValueError`` unless ``value`` is HTTPS on a public host."""

    hostname, port = parse_public_https_origin(value)
    await resolve_public_addresses(hostname, port)
