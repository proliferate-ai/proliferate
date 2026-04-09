from __future__ import annotations

import logging
from typing import Any

from posthog import Posthog

from proliferate.config import settings
from proliferate.middleware.request_context import get_request_id
from proliferate.utils.telemetry_scrub import scrub_mapping

logger = logging.getLogger(__name__)

_posthog_client: Posthog | None = None
_identified_users: set[str] = set()


def _get_posthog_client() -> Posthog | None:
    global _posthog_client

    if _posthog_client is not None:
        return _posthog_client

    if not settings.posthog_project_api_key:
        return None

    _posthog_client = Posthog(
        project_api_key=settings.posthog_project_api_key,
        host=settings.posthog_host,
        flush_at=20,
        flush_interval=0.5,
        disable_geoip=True,
    )
    return _posthog_client


def identify_posthog_user(
    user_id: str,
    email: str,
    display_name: str | None,
) -> None:
    if user_id in _identified_users:
        return

    client = _get_posthog_client()
    if client is None:
        return

    try:
        client.set(
            distinct_id=user_id,
            properties=scrub_mapping(
                {
                    "email": email,
                    "display_name": display_name,
                }
            )
            or {},
        )
        _identified_users.add(user_id)
    except Exception:
        logger.exception("Failed to identify PostHog user")


def track_cloud_api_event(
    user_id: str,
    email: str,
    display_name: str | None,
    event: str,
    properties: dict[str, Any] | None = None,
) -> None:
    client = _get_posthog_client()
    if client is None:
        return

    identify_posthog_user(user_id, email, display_name)

    payload = dict(properties or {})
    request_id = get_request_id()
    if request_id:
        payload["request_id"] = request_id

    try:
        client.capture(
            event=event,
            distinct_id=user_id,
            properties=scrub_mapping(payload) or {},
        )
    except Exception:
        logger.exception("Failed to capture PostHog event")


def shutdown_posthog_client() -> None:
    global _posthog_client

    if _posthog_client is None:
        return

    try:
        _posthog_client.shutdown()  # type: ignore[no-untyped-call]
    finally:
        _posthog_client = None
        _identified_users.clear()
