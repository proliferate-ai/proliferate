"""Customer.io lifecycle integration for auth-driven user messaging."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import httpx

from proliferate.config import settings

CIO_TRACK_BASE = "https://track.customer.io/api/v1"
CIO_APP_BASE = "https://api.customer.io/v1"
CUSTOMERIO_TIMEOUT_SECONDS = 5.0
DESKTOP_AUTHENTICATED_EVENT = "desktop_authenticated"
# Cap message_data string fields before sending. The Customer.io Liquid
# template owns escaping, but capping length here bounds the blast radius of
# any future template that forgets to escape display_name / github_login.
_MESSAGE_DATA_MAX_LEN = 256

logger = logging.getLogger(__name__)


def _customerio_enabled() -> bool:
    return bool(settings.customerio_site_id and settings.customerio_api_key)


def customerio_welcome_email_enabled() -> bool:
    return bool(
        settings.customerio_app_api_key
        and settings.customerio_welcome_transactional_message_id
        and settings.customerio_from_email
    )


def _warn_customerio_failure(message: str, exc: BaseException) -> None:
    """Log a Customer.io API failure without leaking PII or auth headers.

    `httpx.HTTPStatusError.request` includes the URL (and on the Track API the
    basic-auth credentials) and the response body can echo the recipient email.
    We log only a static message + status code.
    """
    status_code = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
    logger.warning("%s (status=%s, error_type=%s)", message, status_code, type(exc).__name__)


async def identify_customerio_user(
    *,
    user_id: str,
    email: str,
    display_name: str | None,
    github_login: str | None = None,
    github_avatar_url: str | None = None,
    created_at: datetime | None = None,
) -> None:
    if not _customerio_enabled():
        return

    payload: dict[str, Any] = {
        "email": email,
        "desktop_authenticated": True,
        "desktop_auth_provider": "github",
        "product_ready": True,
    }
    if display_name:
        payload["display_name"] = display_name
    if github_login:
        payload["github_login"] = github_login
    if github_avatar_url:
        payload["github_avatar_url"] = github_avatar_url
    if created_at is not None:
        payload["created_at"] = int(created_at.timestamp())

    try:
        async with httpx.AsyncClient(timeout=CUSTOMERIO_TIMEOUT_SECONDS) as client:
            response = await client.put(
                f"{CIO_TRACK_BASE}/customers/{user_id}",
                auth=(settings.customerio_site_id, settings.customerio_api_key),
                json=payload,
            )
            response.raise_for_status()
    except Exception as exc:
        _warn_customerio_failure("Failed to identify Customer.io user", exc)


async def track_customerio_desktop_authenticated(
    *,
    user_id: str,
) -> None:
    if not _customerio_enabled():
        return

    try:
        async with httpx.AsyncClient(timeout=CUSTOMERIO_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{CIO_TRACK_BASE}/customers/{user_id}/events",
                auth=(settings.customerio_site_id, settings.customerio_api_key),
                json={
                    "name": DESKTOP_AUTHENTICATED_EVENT,
                    "data": {"auth_provider": "github"},
                },
            )
            response.raise_for_status()
    except Exception as exc:
        _warn_customerio_failure("Failed to track Customer.io desktop authentication event", exc)


async def send_customerio_welcome_email(
    *,
    user_id: str,
    email: str,
    display_name: str | None,
    github_login: str | None,
) -> bool:
    """Send the welcome transactional email via Customer.io App API.

    Returns True when the API accepted the send, False on transient/network
    failure (the caller may clear the dedupe claim and retry on next auth).
    Callers should gate on `customerio_welcome_email_enabled()` first; this
    function does not re-check, so it raises an `AssertionError` if invoked
    without config.
    """
    assert customerio_welcome_email_enabled(), (
        "send_customerio_welcome_email called without App API config"
    )

    message_data: dict[str, Any] = {}
    if display_name:
        message_data["display_name"] = display_name[:_MESSAGE_DATA_MAX_LEN]
    if github_login:
        message_data["github_login"] = github_login[:_MESSAGE_DATA_MAX_LEN]

    payload: dict[str, Any] = {
        "transactional_message_id": settings.customerio_welcome_transactional_message_id,
        "to": email,
        "from": settings.customerio_from_email,
        "identifiers": {"id": user_id},
        "message_data": message_data,
    }

    try:
        async with httpx.AsyncClient(timeout=CUSTOMERIO_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{CIO_APP_BASE}/send/email",
                headers={"Authorization": f"Bearer {settings.customerio_app_api_key}"},
                json=payload,
            )
            response.raise_for_status()
    except Exception as exc:
        _warn_customerio_failure("Failed to send Customer.io welcome email", exc)
        return False
    return True
