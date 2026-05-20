from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.analytics import (
    ClientDailyActivity,
    CloudMcpConnectionEvent,
    CloudWorkspaceMobilityEvent,
)
from proliferate.utils.time import utcnow


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
class CloudMcpConnectionEventInsert:
    user_id: UUID
    org_id: UUID | None
    connection_id: str
    catalog_entry_id: str
    event_type: str
    auth_kind: str | None = None
    auth_status: str | None = None
    enabled: bool | None = None
    failure_code: str | None = None
    occurred_at: datetime | None = None


@dataclass(frozen=True)
class CloudWorkspaceMobilityEventInsert:
    user_id: UUID
    cloud_workspace_id: UUID | None
    handoff_op_id: UUID | None
    event_type: str
    direction: str | None = None
    source_owner: str | None = None
    target_owner: str | None = None
    from_phase: str | None = None
    to_phase: str | None = None
    failure_code: str | None = None
    occurred_at: datetime | None = None


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


async def record_cloud_mcp_connection_event(
    db: AsyncSession,
    event: CloudMcpConnectionEventInsert,
) -> None:
    occurred_at = event.occurred_at or utcnow()
    db.add(
        CloudMcpConnectionEvent(
            id=uuid4(),
            user_id=event.user_id,
            org_id=event.org_id,
            connection_id=event.connection_id,
            catalog_entry_id=event.catalog_entry_id,
            event_type=event.event_type,
            auth_kind=event.auth_kind,
            auth_status=event.auth_status,
            enabled=event.enabled,
            failure_code=event.failure_code,
            occurred_at=occurred_at,
        )
    )


async def record_cloud_workspace_mobility_event(
    db: AsyncSession,
    event: CloudWorkspaceMobilityEventInsert,
) -> None:
    occurred_at = event.occurred_at or utcnow()
    db.add(
        CloudWorkspaceMobilityEvent(
            id=uuid4(),
            user_id=event.user_id,
            cloud_workspace_id=event.cloud_workspace_id,
            handoff_op_id=event.handoff_op_id,
            event_type=event.event_type,
            direction=event.direction,
            source_owner=event.source_owner,
            target_owner=event.target_owner,
            from_phase=event.from_phase,
            to_phase=event.to_phase,
            failure_code=event.failure_code,
            occurred_at=occurred_at,
        )
    )
