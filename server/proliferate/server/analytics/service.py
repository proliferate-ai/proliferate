from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.analytics import (
    ClientDailyActivityUpsert,
    upsert_client_daily_activity,
)
from proliferate.errors import InvalidRequest
from proliferate.server.analytics.models import ClientDailyActivityRequest
from proliferate.utils.time import utcnow


async def record_client_daily_activity(
    db: AsyncSession,
    *,
    user_id: UUID | None,
    body: ClientDailyActivityRequest,
) -> None:
    if user_id is None and body.anonymous_install_uuid is None:
        raise InvalidRequest(
            "anonymousInstallUuid is required for unauthenticated activity.",
            code="anonymous_install_uuid_required",
        )

    received_at = utcnow()
    await upsert_client_daily_activity(
        db,
        ClientDailyActivityUpsert(
            activity_date=received_at.date(),
            surface=body.surface,
            actor_user_id=user_id,
            anonymous_install_uuid=body.anonymous_install_uuid,
            telemetry_mode=body.telemetry_mode,
            app_version=body.app_version,
            platform=body.platform,
            route_or_screen=body.route_or_screen,
            received_at=received_at,
        ),
    )
