"""Customer.io lifecycle integration for auth-driven user messaging."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import httpx

from proliferate.auth.sso.policy import email_domain
from proliferate.config import settings
from proliferate.constants.organizations import PUBLIC_EMAIL_DOMAINS

CIO_TRACK_BASE = "https://track.customer.io/api/v1"
CUSTOMERIO_TIMEOUT_SECONDS = 5.0
DESKTOP_AUTHENTICATED_EVENT = "desktop_authenticated"

logger = logging.getLogger(__name__)


def _customerio_enabled() -> bool:
    return bool(settings.customerio_site_id and settings.customerio_api_key)


def derive_email_type(email: str | None) -> str:
    """Classify an email as 'company' or 'personal'.

    Personal = domain in PUBLIC_EMAIL_DOMAINS (or missing/malformed domain).
    Company = any other domain.
    """
    domain = email_domain(email)
    if domain is None or domain in PUBLIC_EMAIL_DOMAINS:
        return "personal"
    return "company"


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
        "email_type": derive_email_type(email),
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


async def push_user_attributes(
    *,
    user_id: str,
    attributes: dict[str, Any],
) -> bool:
    """Push attributes to a Customer.io user profile via the Track API.

    Returns True on success, False on failure.
    """
    if not _customerio_enabled():
        return False

    try:
        async with httpx.AsyncClient(timeout=CUSTOMERIO_TIMEOUT_SECONDS) as client:
            response = await client.put(
                f"{CIO_TRACK_BASE}/customers/{user_id}",
                auth=(settings.customerio_site_id, settings.customerio_api_key),
                json=attributes,
            )
            response.raise_for_status()
    except Exception as exc:
        _warn_customerio_failure("Failed to push Customer.io user attributes", exc)
        return False
    return True
