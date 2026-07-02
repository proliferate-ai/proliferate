"""LLM credit grant ledger + remaining-credit math (PR 8).

Grants are the credit side; imported ``agent_llm_usage_event`` rows are the
debit side. Remaining credit for a billing subject is::

    sum(active grants.amount_usd) - sum(usage.cost_usd)

Everything sums in :class:`~decimal.Decimal` so free-credit math stays exact
(a cent is never lost to float drift). There is no per-grant consumption row.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import LLM_CREDIT_SOURCE_TOPUP
from proliferate.db.models.cloud.agent_gateway import (
    AgentLlmUsageEvent,
    LlmCreditGrant,
)
from proliferate.db.store.agent_gateway.mappers import llm_credit_grant_record
from proliferate.db.store.agent_gateway.records import (
    LlmCreditBalanceRecord,
    LlmCreditGrantRecord,
)
from proliferate.utils.time import utcnow

_ZERO = Decimal("0")


async def create_llm_credit_grant(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    source: str,
    amount_usd: Decimal,
    user_id: UUID | None = None,
    expires_at: datetime | None = None,
    source_ref: str | None = None,
) -> LlmCreditGrantRecord:
    """Insert a credit grant.

    When ``source_ref`` is set the insert is idempotent (unique constraint):
    a duplicate returns the existing grant untouched. This is how the
    free-signup grant is deduped alongside the ``free_cloud_allocation`` guard.
    """
    now = utcnow()
    if source_ref is not None:
        result = await db.execute(
            pg_insert(LlmCreditGrant)
            .values(
                billing_subject_id=billing_subject_id,
                user_id=user_id,
                source=source,
                amount_usd=amount_usd,
                created_at=now,
                expires_at=expires_at,
                source_ref=source_ref,
            )
            .on_conflict_do_nothing(index_elements=[LlmCreditGrant.source_ref])
            .returning(LlmCreditGrant.id)
        )
        grant_id = result.scalar_one_or_none()
        if grant_id is None:
            existing = (
                await db.execute(
                    select(LlmCreditGrant).where(LlmCreditGrant.source_ref == source_ref)
                )
            ).scalar_one()
            return llm_credit_grant_record(existing)
        row = await db.get(LlmCreditGrant, grant_id)
        if row is None:
            raise RuntimeError("LLM credit grant disappeared after creation.")
        return llm_credit_grant_record(row)

    row = LlmCreditGrant(
        billing_subject_id=billing_subject_id,
        user_id=user_id,
        source=source,
        amount_usd=amount_usd,
        created_at=now,
        expires_at=expires_at,
        source_ref=None,
    )
    db.add(row)
    await db.flush()
    return llm_credit_grant_record(row)


async def count_topup_grants(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> int:
    """Number of top-up grants a subject holds.

    The auto top-up worker derives its Stripe idempotency key from this count
    (the "top-up epoch"): a tick that crashed between charging and granting
    replays with the same key, so Stripe returns the same invoice and the
    grant's ``source_ref`` dedupe closes the loop.
    """
    total = await db.scalar(
        select(func.count()).where(
            LlmCreditGrant.billing_subject_id == billing_subject_id,
            LlmCreditGrant.source == LLM_CREDIT_SOURCE_TOPUP,
        )
    )
    return int(total or 0)


async def sum_active_grants_usd(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    now: datetime | None = None,
) -> Decimal:
    """Sum grant amounts for a subject, excluding grants that have expired."""
    at = now or utcnow()
    total = await db.scalar(
        select(func.coalesce(func.sum(LlmCreditGrant.amount_usd), _ZERO)).where(
            LlmCreditGrant.billing_subject_id == billing_subject_id,
            or_(
                LlmCreditGrant.expires_at.is_(None),
                LlmCreditGrant.expires_at > at,
            ),
        )
    )
    return _as_decimal(total)


async def sum_usage_cost_usd(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> Decimal:
    """Sum imported usage cost (the debit side) for a subject."""
    total = await db.scalar(
        select(func.coalesce(func.sum(AgentLlmUsageEvent.cost_usd), _ZERO)).where(
            AgentLlmUsageEvent.billing_subject_id == billing_subject_id
        )
    )
    return _as_decimal(total)


async def get_remaining_credit_usd(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    now: datetime | None = None,
) -> LlmCreditBalanceRecord:
    granted = await sum_active_grants_usd(db, billing_subject_id, now=now)
    used = await sum_usage_cost_usd(db, billing_subject_id)
    return LlmCreditBalanceRecord(
        billing_subject_id=billing_subject_id,
        granted_usd=granted,
        used_usd=used,
        remaining_usd=granted - used,
    )


def _as_decimal(value: object) -> Decimal:
    """Coerce a SQL SUM (Decimal, float, int, or None) to Decimal.

    ``cost_usd`` maps with ``asdecimal=False`` so its SUM comes back as a
    float; grant amounts come back as Decimal. Normalize both.
    """
    if value is None:
        return _ZERO
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))
