"""Slack event dedupe and inbound job persistence."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.slack import (
    SLACK_INBOUND_JOB_STATUS_COMPLETED,
    SLACK_INBOUND_JOB_STATUS_FAILED,
    SLACK_INBOUND_JOB_STATUS_PROCESSING,
    SLACK_INBOUND_JOB_STATUS_QUEUED,
)
from proliferate.db.models.cloud.slack import SlackEventEnvelopeSeen, SlackInboundEventJob
from proliferate.db.store.cloud_slack.records import SlackInboundEventJobRecord
from proliferate.utils.time import utcnow


def _record(row: SlackInboundEventJob) -> SlackInboundEventJobRecord:
    return SlackInboundEventJobRecord(
        id=row.id,
        slack_event_id=row.slack_event_id,
        organization_id=row.organization_id,
        slack_team_id=row.slack_team_id,
        event_type=row.event_type,
        payload_json=dict(row.payload_json or {}),
        status=row.status,
        attempts=row.attempts,
        next_attempt_at=row.next_attempt_at,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
        completed_at=row.completed_at,
    )


async def mark_event_seen_once(
    db: AsyncSession,
    *,
    slack_event_id: str,
    organization_id: UUID | None,
) -> bool:
    now = utcnow()
    result = await db.execute(
        pg_insert(SlackEventEnvelopeSeen)
        .values(
            slack_event_id=slack_event_id,
            organization_id=organization_id,
            received_at=now,
        )
        .on_conflict_do_nothing(index_elements=[SlackEventEnvelopeSeen.slack_event_id])
        .returning(SlackEventEnvelopeSeen.slack_event_id)
    )
    return result.scalar_one_or_none() is not None


async def create_inbound_job(
    db: AsyncSession,
    *,
    slack_event_id: str,
    organization_id: UUID | None,
    slack_team_id: str | None,
    event_type: str,
    payload_json: dict[str, object],
) -> SlackInboundEventJobRecord:
    now = utcnow()
    row = SlackInboundEventJob(
        slack_event_id=slack_event_id,
        organization_id=organization_id,
        slack_team_id=slack_team_id,
        event_type=event_type,
        payload_json=payload_json,
        status=SLACK_INBOUND_JOB_STATUS_QUEUED,
        attempts=0,
        next_attempt_at=now,
        last_error_code=None,
        last_error_message=None,
        created_at=now,
        updated_at=now,
        completed_at=None,
    )
    db.add(row)
    await db.flush()
    return _record(row)


async def get_inbound_job(
    db: AsyncSession,
    job_id: UUID,
) -> SlackInboundEventJobRecord | None:
    row = await db.get(SlackInboundEventJob, job_id)
    return _record(row) if row is not None else None


async def mark_job_processing(
    db: AsyncSession,
    job_id: UUID,
) -> SlackInboundEventJobRecord | None:
    row = (
        await db.execute(
            select(SlackInboundEventJob)
            .where(SlackInboundEventJob.id == job_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None or row.status not in {
        SLACK_INBOUND_JOB_STATUS_QUEUED,
        SLACK_INBOUND_JOB_STATUS_FAILED,
    }:
        return _record(row) if row is not None else None
    now = utcnow()
    row.status = SLACK_INBOUND_JOB_STATUS_PROCESSING
    row.attempts += 1
    row.updated_at = now
    await db.flush()
    return _record(row)


async def mark_job_completed(
    db: AsyncSession,
    job_id: UUID,
) -> SlackInboundEventJobRecord | None:
    row = await db.get(SlackInboundEventJob, job_id)
    if row is None:
        return None
    now = utcnow()
    row.status = SLACK_INBOUND_JOB_STATUS_COMPLETED
    row.completed_at = now
    row.updated_at = now
    await db.flush()
    return _record(row)


async def mark_job_failed(
    db: AsyncSession,
    job_id: UUID,
    *,
    error_code: str,
    error_message: str,
) -> SlackInboundEventJobRecord | None:
    row = await db.get(SlackInboundEventJob, job_id)
    if row is None:
        return None
    row.status = SLACK_INBOUND_JOB_STATUS_FAILED
    row.last_error_code = error_code
    row.last_error_message = error_message[:1000]
    row.updated_at = utcnow()
    await db.flush()
    return _record(row)
