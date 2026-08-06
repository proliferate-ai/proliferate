from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.analytics import ClientDailyActivity


@dataclass(frozen=True)
class ClientDailyActivityUpsert:
    activity_date: date
    surface: str
    actor_user_id: UUID | None
    anonymous_install_uuid: UUID | None
    telemetry_mode: str | None
    app_version: str | None
    platform: str | None
    route_or_screen: str | None
    received_at: datetime


@dataclass(frozen=True)
class LatestClientActivityValue:
    actor_user_id: UUID
    last_seen_at: datetime


async def list_latest_client_activity(
    db: AsyncSession,
    *,
    actor_user_ids: tuple[UUID, ...],
) -> tuple[LatestClientActivityValue, ...]:
    if not actor_user_ids:
        return ()
    rows = (
        await db.execute(
            select(
                ClientDailyActivity.actor_user_id,
                func.max(ClientDailyActivity.last_seen_at).label("last_seen_at"),
            )
            .where(ClientDailyActivity.actor_user_id.in_(actor_user_ids))
            .group_by(ClientDailyActivity.actor_user_id)
        )
    ).all()
    return tuple(
        LatestClientActivityValue(
            actor_user_id=row.actor_user_id,
            last_seen_at=row.last_seen_at,
        )
        for row in rows
        if row.actor_user_id is not None and row.last_seen_at is not None
    )


async def upsert_client_daily_activity(
    db: AsyncSession,
    event: ClientDailyActivityUpsert,
) -> None:
    values = {
        "id": uuid4(),
        "activity_date": event.activity_date,
        "surface": event.surface,
        "actor_user_id": event.actor_user_id,
        "anonymous_install_uuid": event.anonymous_install_uuid,
        "telemetry_mode": event.telemetry_mode,
        "app_version": event.app_version,
        "platform": event.platform,
        "route_or_screen": event.route_or_screen,
        "created_at": event.received_at,
        "last_seen_at": event.received_at,
        "received_count": 1,
    }
    statement = insert(ClientDailyActivity).values(**values)
    update_values = {
        "anonymous_install_uuid": event.anonymous_install_uuid,
        "telemetry_mode": event.telemetry_mode,
        "app_version": event.app_version,
        "platform": event.platform,
        "route_or_screen": event.route_or_screen,
        "last_seen_at": event.received_at,
        "received_count": ClientDailyActivity.received_count + 1,
    }

    if event.actor_user_id is not None:
        await db.execute(
            statement.on_conflict_do_update(
                index_elements=[
                    ClientDailyActivity.activity_date,
                    ClientDailyActivity.surface,
                    ClientDailyActivity.actor_user_id,
                ],
                index_where=ClientDailyActivity.actor_user_id.is_not(None),
                set_=update_values,
            )
        )
        return

    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[
                ClientDailyActivity.activity_date,
                ClientDailyActivity.surface,
                ClientDailyActivity.anonymous_install_uuid,
            ],
            index_where=(
                ClientDailyActivity.actor_user_id.is_(None)
                & ClientDailyActivity.anonymous_install_uuid.is_not(None)
            ),
            set_=update_values,
        )
    )
