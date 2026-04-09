from __future__ import annotations

from typing import Any

from proliferate.db.models.auth import User
from proliferate.integrations.posthog import track_cloud_api_event


def track_cloud_event(
    user: User,
    event: str,
    properties: dict[str, Any],
) -> None:
    track_cloud_api_event(
        user_id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        event=event,
        properties=properties,
    )
