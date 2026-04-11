"""Customer.io lifecycle integration for auth-driven user messaging."""

from __future__ import annotations

import logging

import httpx

from proliferate.config import settings

CIO_BASE = "https://track.customer.io/api/v1"
CUSTOMERIO_TIMEOUT_SECONDS = 5.0
DESKTOP_AUTHENTICATED_EVENT = "desktop_authenticated"

logger = logging.getLogger(__name__)


def _customerio_enabled() -> bool:
    return bool(settings.customerio_site_id and settings.customerio_api_key)


async def identify_customerio_user(
    *,
    user_id: str,
    email: str,
    display_name: str | None,
) -> None:
    if not _customerio_enabled():
        return

    payload: dict[str, str | bool] = {
        "email": email,
        "desktop_authenticated": True,
        "desktop_auth_provider": "github",
    }
    if display_name:
        payload["display_name"] = display_name

    try:
        async with httpx.AsyncClient(timeout=CUSTOMERIO_TIMEOUT_SECONDS) as client:
            response = await client.put(
                f"{CIO_BASE}/customers/{user_id}",
                auth=(settings.customerio_site_id, settings.customerio_api_key),
                json=payload,
            )
            response.raise_for_status()
    except Exception:
        logger.exception("Failed to identify Customer.io user")


async def track_customerio_desktop_authenticated(
    *,
    user_id: str,
) -> None:
    if not _customerio_enabled():
        return

    try:
        async with httpx.AsyncClient(timeout=CUSTOMERIO_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{CIO_BASE}/customers/{user_id}/events",
                auth=(settings.customerio_site_id, settings.customerio_api_key),
                json={
                    "name": DESKTOP_AUTHENTICATED_EVENT,
                    "data": {"auth_provider": "github"},
                },
            )
            response.raise_for_status()
    except Exception:
        logger.exception("Failed to track Customer.io desktop authentication event")
