"""Slack outbound message queue persistence."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.slack import (
    SLACK_OUTBOUND_STATUS_DROPPED,
    SLACK_OUTBOUND_STATUS_FAILED,
    SLACK_OUTBOUND_STATUS_QUEUED,
    SLACK_OUTBOUND_STATUS_SENDING,
    SLACK_OUTBOUND_STATUS_SENT,
)
from proliferate.db.models.cloud.slack import SlackOutboundMessageQueue
from proliferate.db.store.cloud_slack.records import SlackOutboundMessageRecord
from proliferate.utils.time import utcnow


def _record(row: SlackOutboundMessageQueue) -> SlackOutboundMessageRecord:
    return SlackOutboundMessageRecord(
        id=row.id,
        organization_id=row.organization_id,
        slack_workspace_connection_id=row.slack_workspace_connection_id,
        slack_team_id=row.slack_team_id,
        slack_channel_id=row.slack_channel_id,
        slack_thread_ts=row.slack_thread_ts,
        blocks_json=list(row.blocks_json or []),
        fallback_text=row.fallback_text,
        source=row.source,
        source_event_id=row.source_event_id,
        status=row.status,
        attempts=row.attempts,
        next_attempt_at=row.next_attempt_at,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        sent_message_ts=row.sent_message_ts,
        created_at=row.created_at,
        updated_at=row.updated_at,
        sent_at=row.sent_at,
    )


async def enqueue_outbound_message(
    db: AsyncSession,
    *,
    organization_id: UUID,
    slack_workspace_connection_id: UUID,
    slack_team_id: str,
    slack_channel_id: str,
    slack_thread_ts: str | None,
    blocks_json: list[dict[str, object]],
    fallback_text: str,
    source: str,
    source_event_id: str | None,
) -> SlackOutboundMessageRecord:
    now = utcnow()
    row = SlackOutboundMessageQueue(
        organization_id=organization_id,
        slack_workspace_connection_id=slack_workspace_connection_id,
        slack_team_id=slack_team_id,
        slack_channel_id=slack_channel_id,
        slack_thread_ts=slack_thread_ts,
        blocks_json=blocks_json,
        fallback_text=fallback_text,
        source=source,
        source_event_id=source_event_id,
        status=SLACK_OUTBOUND_STATUS_QUEUED,
        attempts=0,
        next_attempt_at=now,
        last_error_code=None,
        last_error_message=None,
        sent_message_ts=None,
        created_at=now,
        updated_at=now,
        sent_at=None,
    )
    db.add(row)
    await db.flush()
    return _record(row)


async def list_due_outbound_messages(
    db: AsyncSession,
    *,
    now: datetime,
    limit: int,
) -> list[SlackOutboundMessageRecord]:
    rows = (
        (
            await db.execute(
                select(SlackOutboundMessageQueue)
                .where(SlackOutboundMessageQueue.status == SLACK_OUTBOUND_STATUS_QUEUED)
                .where(SlackOutboundMessageQueue.next_attempt_at <= now)
                .order_by(SlackOutboundMessageQueue.created_at.asc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [_record(row) for row in rows]


async def mark_outbound_sending(
    db: AsyncSession,
    *,
    message_id: UUID,
) -> SlackOutboundMessageRecord | None:
    row = (
        await db.execute(
            select(SlackOutboundMessageQueue)
            .where(SlackOutboundMessageQueue.id == message_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None or row.status != SLACK_OUTBOUND_STATUS_QUEUED:
        return _record(row) if row is not None else None
    row.status = SLACK_OUTBOUND_STATUS_SENDING
    row.updated_at = utcnow()
    await db.flush()
    return _record(row)


async def mark_outbound_sent(
    db: AsyncSession,
    *,
    message_id: UUID,
    sent_message_ts: str,
) -> SlackOutboundMessageRecord | None:
    row = await db.get(SlackOutboundMessageQueue, message_id)
    if row is None:
        return None
    now = utcnow()
    row.status = SLACK_OUTBOUND_STATUS_SENT
    row.sent_message_ts = sent_message_ts
    row.sent_at = now
    row.updated_at = now
    await db.flush()
    return _record(row)


async def mark_outbound_retry(
    db: AsyncSession,
    *,
    message_id: UUID,
    attempts: int,
    next_attempt_at: datetime,
    error_code: str,
    error_message: str,
    dropped: bool,
) -> SlackOutboundMessageRecord | None:
    row = await db.get(SlackOutboundMessageQueue, message_id)
    if row is None:
        return None
    row.status = SLACK_OUTBOUND_STATUS_DROPPED if dropped else SLACK_OUTBOUND_STATUS_QUEUED
    row.attempts = attempts
    row.next_attempt_at = next_attempt_at
    row.last_error_code = error_code
    row.last_error_message = error_message[:1000]
    row.updated_at = utcnow()
    await db.flush()
    return _record(row)


async def mark_outbound_failed(
    db: AsyncSession,
    *,
    message_id: UUID,
    error_code: str,
    error_message: str,
) -> SlackOutboundMessageRecord | None:
    row = await db.get(SlackOutboundMessageQueue, message_id)
    if row is None:
        return None
    row.status = SLACK_OUTBOUND_STATUS_FAILED
    row.last_error_code = error_code
    row.last_error_message = error_message[:1000]
    row.updated_at = utcnow()
    await db.flush()
    return _record(row)
