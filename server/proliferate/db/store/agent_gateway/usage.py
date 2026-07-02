"""Agent LLM usage ledger + import cursor persistence (PR 8 consumer)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
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
