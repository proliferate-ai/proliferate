"""Agent LLM usage ledger + import cursor persistence (PR 8 consumer)."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import AGENT_USAGE_IMPORT_CURSOR_ID
from proliferate.db.models.cloud.agent_gateway import (
    AgentLlmUsageEvent,
    AgentLlmUsageImportCursor,
)
from proliferate.db.store.agent_gateway.mappers import usage_import_cursor_record
from proliferate.db.store.agent_gateway.records import AgentLlmUsageImportCursorRecord
from proliferate.utils.time import utcnow


async def insert_usage_event_once(
    db: AsyncSession,
    *,
    litellm_request_id: str,
    occurred_at: datetime,
    virtual_key_id: str | None = None,
    litellm_team_id: str | None = None,
    user_id: UUID | None = None,
    organization_id: UUID | None = None,
    billing_subject_id: UUID | None = None,
    provider: str | None = None,
    model: str | None = None,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
    cost_usd: float | None = None,
    status: str = "imported",
    workspace_id: str | None = None,
    session_id: str | None = None,
    raw_metadata_json: str | None = None,
) -> bool:
    """Insert a usage event; returns False when the request id was already seen."""
    result = await db.execute(
        pg_insert(AgentLlmUsageEvent)
        .values(
            litellm_request_id=litellm_request_id,
            virtual_key_id=virtual_key_id,
            litellm_team_id=litellm_team_id,
            user_id=user_id,
            organization_id=organization_id,
            billing_subject_id=billing_subject_id,
            provider=provider,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cost_usd=cost_usd,
            status=status,
            workspace_id=workspace_id,
            session_id=session_id,
            occurred_at=occurred_at,
            imported_at=utcnow(),
            raw_metadata_json=raw_metadata_json,
        )
        .on_conflict_do_nothing(index_elements=[AgentLlmUsageEvent.litellm_request_id])
        .returning(AgentLlmUsageEvent.id)
    )
    return result.scalar_one_or_none() is not None


async def get_usage_import_cursor(
    db: AsyncSession,
) -> AgentLlmUsageImportCursorRecord | None:
    row = (
        await db.execute(
            select(AgentLlmUsageImportCursor).where(
                AgentLlmUsageImportCursor.id == AGENT_USAGE_IMPORT_CURSOR_ID
            )
        )
    ).scalar_one_or_none()
    return usage_import_cursor_record(row) if row is not None else None


async def advance_usage_import_cursor(
    db: AsyncSession,
    *,
    last_seen_occurred_at: datetime | None,
    status: str = "idle",
    last_error_code: str | None = None,
    last_error_message: str | None = None,
    metadata_json: str | None = None,
) -> AgentLlmUsageImportCursorRecord:
    now = utcnow()
    row = (
        await db.execute(
            select(AgentLlmUsageImportCursor).where(
                AgentLlmUsageImportCursor.id == AGENT_USAGE_IMPORT_CURSOR_ID
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = AgentLlmUsageImportCursor(
            id=AGENT_USAGE_IMPORT_CURSOR_ID,
            last_seen_occurred_at=last_seen_occurred_at,
            last_polled_at=now,
            status=status,
            last_error_code=last_error_code,
            last_error_message=last_error_message,
            metadata_json=metadata_json,
        )
        db.add(row)
    else:
        if last_seen_occurred_at is not None:
            row.last_seen_occurred_at = last_seen_occurred_at
        row.last_polled_at = now
        row.status = status
        row.last_error_code = last_error_code
        row.last_error_message = last_error_message
        if metadata_json is not None:
            row.metadata_json = metadata_json
        row.updated_at = now
    await db.flush()
    return usage_import_cursor_record(row)


def _coerce_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


async def llm_cost_usd_timeseries(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    granularity: str,
    start: datetime,
    end: datetime,
    user_id: UUID | None = None,
) -> list[tuple[datetime, float]]:
    """Imported LLM cost bucketed by ``date_trunc(granularity, occurred_at)``.

    Scoped to a billing subject (org or personal); optionally filtered to one
    user. Missing buckets are not zero-filled here — the caller fills gaps.
    """
    bucket = func.date_trunc(granularity, AgentLlmUsageEvent.occurred_at)
    conditions = [
        AgentLlmUsageEvent.billing_subject_id == billing_subject_id,
        AgentLlmUsageEvent.occurred_at >= _coerce_utc(start),
        AgentLlmUsageEvent.occurred_at < _coerce_utc(end),
    ]
    if user_id is not None:
        conditions.append(AgentLlmUsageEvent.user_id == user_id)
    rows = (
        await db.execute(
            select(
                bucket.label("bucket"),
                func.coalesce(func.sum(AgentLlmUsageEvent.cost_usd), 0.0),
            )
            .where(*conditions)
            .group_by(bucket)
            .order_by(bucket)
        )
    ).all()
    return [(_coerce_utc(bucket_start), float(cost or 0.0)) for bucket_start, cost in rows]


async def llm_cost_usd_by_user(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    start: datetime,
    end: datetime,
) -> dict[UUID, float]:
    """Imported LLM cost per user over ``[start, end)`` for a subject."""
    rows = (
        await db.execute(
            select(
                AgentLlmUsageEvent.user_id,
                func.coalesce(func.sum(AgentLlmUsageEvent.cost_usd), 0.0),
            )
            .where(
                AgentLlmUsageEvent.billing_subject_id == billing_subject_id,
                AgentLlmUsageEvent.occurred_at >= _coerce_utc(start),
                AgentLlmUsageEvent.occurred_at < _coerce_utc(end),
                AgentLlmUsageEvent.user_id.is_not(None),
            )
            .group_by(AgentLlmUsageEvent.user_id)
        )
    ).all()
    return {user_id: float(cost or 0.0) for user_id, cost in rows}


async def llm_cost_usd_in_window(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    start: datetime,
    end: datetime,
    user_id: UUID | None = None,
) -> float:
    """Total imported LLM cost over ``[start, end)`` for enforcement.

    ``user_id=None`` sums the whole subject (org-wide); otherwise it filters to
    that user.
    """
    conditions = [
        AgentLlmUsageEvent.billing_subject_id == billing_subject_id,
        AgentLlmUsageEvent.occurred_at >= _coerce_utc(start),
        AgentLlmUsageEvent.occurred_at < _coerce_utc(end),
    ]
    if user_id is not None:
        conditions.append(AgentLlmUsageEvent.user_id == user_id)
    result = await db.scalar(
        select(func.coalesce(func.sum(AgentLlmUsageEvent.cost_usd), 0.0)).where(*conditions)
    )
    return float(result or 0.0)
