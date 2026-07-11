"""Durable poll-item inbox (spec §10.3) and deterministic action effects (§7.4).

Inbox: ``(trigger_id, external_item_id)`` is the dedupe identity; poison items
get explicit dead-letter state. Actions: ``(run_id, step_key, attempt)`` is the
retry-safe submission identity; ``outcome_uncertain`` never auto-resends.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workflow_ledger import (
    WorkflowActionEffect,
    WorkflowPollInbox,
)
from proliferate.db.store.workflow_ledger.records import (
    ActionEffectRecord,
    PollInboxRecord,
    record_effect,
    record_inbox,
)
from proliferate.utils.time import utcnow


async def upsert_poll_inbox_item(
    db: AsyncSession,
    *,
    trigger_id: UUID,
    external_item_id: str,
    payload_json: dict[str, object],
) -> PollInboxRecord | None:
    """Insert a pending inbox item; ``None`` when ``(trigger_id, external_item_id)``
    already exists (a replayed page item — the dedupe decision)."""

    now = utcnow()
    stmt = (
        pg_insert(WorkflowPollInbox)
        .values(
            id=uuid4(),
            trigger_id=trigger_id,
            external_item_id=external_item_id,
            payload_json=payload_json,
            status="pending",
            attempt_count=0,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(
            index_elements=["trigger_id", "external_item_id"],
        )
        .returning(WorkflowPollInbox.id)
    )
    inserted_id = (await db.execute(stmt)).scalar_one_or_none()
    if inserted_id is None:
        return None
    row = await db.get(WorkflowPollInbox, inserted_id)
    assert row is not None
    return record_inbox(row)


async def get_poll_inbox_item(
    db: AsyncSession, *, trigger_id: UUID, external_item_id: str
) -> PollInboxRecord | None:
    row = (
        await db.execute(
            select(WorkflowPollInbox).where(
                WorkflowPollInbox.trigger_id == trigger_id,
                WorkflowPollInbox.external_item_id == external_item_id,
            )
        )
    ).scalar_one_or_none()
    return None if row is None else record_inbox(row)


async def update_poll_inbox_item(
    db: AsyncSession,
    *,
    inbox_id: UUID,
    status: str | None = None,
    run_id: UUID | None = None,
    last_error: str | None = None,
    increment_attempt: bool = False,
) -> PollInboxRecord | None:
    row = await db.get(WorkflowPollInbox, inbox_id)
    if row is None:
        return None
    if status is not None:
        row.status = status
    if run_id is not None:
        row.run_id = run_id
    if last_error is not None:
        row.last_error = last_error
    if increment_attempt:
        row.attempt_count = row.attempt_count + 1
    row.updated_at = utcnow()
    await db.flush()
    return record_inbox(row)


# --- deterministic action effects (spec §7.4; WS4c fills these) ---------------------


async def insert_action_effect(
    db: AsyncSession,
    *,
    run_id: UUID,
    step_key: str,
    attempt: int,
    action_kind: str,
    payload_json: dict[str, object],
) -> ActionEffectRecord | None:
    """Insert the action effect; ``None`` when ``(run_id, step_key, attempt)``
    already exists (a retried submission recovers the existing identity)."""

    now = utcnow()
    stmt = (
        pg_insert(WorkflowActionEffect)
        .values(
            id=uuid4(),
            run_id=run_id,
            step_key=step_key,
            attempt=attempt,
            action_kind=action_kind,
            payload_json=payload_json,
            status="pending",
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(
            index_elements=["run_id", "step_key", "attempt"],
        )
        .returning(WorkflowActionEffect.id)
    )
    inserted_id = (await db.execute(stmt)).scalar_one_or_none()
    if inserted_id is None:
        return None
    row = await db.get(WorkflowActionEffect, inserted_id)
    assert row is not None
    return record_effect(row)


async def get_action_effect(
    db: AsyncSession, *, run_id: UUID, step_key: str, attempt: int
) -> ActionEffectRecord | None:
    row = (
        await db.execute(
            select(WorkflowActionEffect).where(
                WorkflowActionEffect.run_id == run_id,
                WorkflowActionEffect.step_key == step_key,
                WorkflowActionEffect.attempt == attempt,
            )
        )
    ).scalar_one_or_none()
    return None if row is None else record_effect(row)


async def update_action_effect(
    db: AsyncSession,
    *,
    effect_id: UUID,
    status: str | None = None,
    provider_operation_id: str | None = None,
    provider_message_id: str | None = None,
    last_error: str | None = None,
) -> ActionEffectRecord | None:
    row = await db.get(WorkflowActionEffect, effect_id)
    if row is None:
        return None
    if status is not None:
        row.status = status
    if provider_operation_id is not None:
        row.provider_operation_id = provider_operation_id
    if provider_message_id is not None:
        row.provider_message_id = provider_message_id
    if last_error is not None:
        row.last_error = last_error
    row.updated_at = utcnow()
    await db.flush()
    return record_effect(row)
