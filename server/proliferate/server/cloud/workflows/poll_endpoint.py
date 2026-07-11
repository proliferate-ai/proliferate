"""Workflow poll endpoint policy adapter."""

from __future__ import annotations

from proliferate.server.cloud import net_guard
from proliferate.server.cloud.errors import CloudApiError


async def guard_poll_endpoint(
    url: str, *, policy: net_guard.NetworkPolicy = net_guard.PUBLIC_ONLY
) -> net_guard.VettedEndpoint:
    """Resolve and vet one poll URL without blocking the event loop.

    Production uses ``PUBLIC_ONLY``. Tests may inject the narrow loopback-only
    policy; debug/config state never grants network authority.
    """

    try:
        return await net_guard.resolve_and_pin_endpoint_async(url, policy=policy)
    except net_guard.NetGuardError as exc:
        raise CloudApiError("poll_endpoint_blocked", str(exc), status_code=400) from None
