from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.sandboxes import HarnessLaunchOptionState
from proliferate.lib.infra.time.wall_clock import utcnow


@dataclass(frozen=True)
class HarnessLaunchOptionStateValue:
    cloud_sandbox_id: UUID
    harness_kind: str
    source_revision: int
    payload_json: str
    copied_at: datetime


def _value(row: HarnessLaunchOptionState) -> HarnessLaunchOptionStateValue:
    return HarnessLaunchOptionStateValue(
        cloud_sandbox_id=row.cloud_sandbox_id,
        harness_kind=row.harness_kind,
        source_revision=row.source_revision,
        payload_json=row.payload_json,
        copied_at=row.copied_at,
    )


async def upsert_if_newer(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
    harness_kind: str,
    source_revision: int,
    payload_json: str,
) -> None:
    statement = insert(HarnessLaunchOptionState).values(
        cloud_sandbox_id=cloud_sandbox_id,
        harness_kind=harness_kind,
        source_revision=source_revision,
        payload_json=payload_json,
        copied_at=utcnow(),
    )
    statement = statement.on_conflict_do_update(
        index_elements=[
            HarnessLaunchOptionState.cloud_sandbox_id,
            HarnessLaunchOptionState.harness_kind,
        ],
        set_={
            "source_revision": statement.excluded.source_revision,
            "payload_json": statement.excluded.payload_json,
            "copied_at": statement.excluded.copied_at,
        },
        where=statement.excluded.source_revision > HarnessLaunchOptionState.source_revision,
    )
    await db.execute(statement)


async def get(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
    harness_kind: str,
) -> HarnessLaunchOptionStateValue | None:
    row = await db.scalar(
        select(HarnessLaunchOptionState).where(
            HarnessLaunchOptionState.cloud_sandbox_id == cloud_sandbox_id,
            HarnessLaunchOptionState.harness_kind == harness_kind,
        )
    )
    return _value(row) if row is not None else None
