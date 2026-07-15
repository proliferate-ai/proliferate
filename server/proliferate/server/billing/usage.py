"""Personal + owner-scoped usage read models: summary, timeseries, LLM balance.

Implements spec §3.1, §3.2, §3.5. Aggregates ride the raw `usage_segment` /
`agent_llm_usage_event` ledgers via `db/store/billing.py` and
`db/store/agent_gateway/usage.py` — no rollup table yet (see the rollup-seam
comment at those query sites).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import OwnerContext
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.models.billing import BillingBudgetLimit
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store import billing as billing_store
from proliferate.server.billing import snapshots as billing_snapshots
from proliferate.server.billing.budget_limits import (
    bucket_starts,
    resolve_effective_limit,
    window_bounds,
)
from proliferate.server.billing.models import (
    BudgetLimitWindowUsage,
    LlmBalance,
    UsageSummary,
    UsageTimeseries,
    UsageTimeseriesBucket,
)
from proliferate.utils.time import utcnow


async def get_usage_summary(
    db: AsyncSession,
    context: OwnerContext,
    *,
    user_id: UUID,
) -> UsageSummary:
    now = utcnow()
    month_start, month_end = window_bounds("month", now)
    compute_used_mtd = await billing_store.compute_usage_seconds_in_window(
        db,
        billing_subject_id=context.billing_subject_id,
        start=month_start,
        end=month_end,
        now=now,
        user_id=user_id,
    )
    llm_used_mtd = await agent_gateway_store.llm_cost_usd_in_window(
        db,
        billing_subject_id=context.billing_subject_id,
        start=month_start,
        end=month_end,
        user_id=user_id,
    )
    snapshot = await billing_snapshots.get_billing_snapshot_for_subject_in_session(
        db,
        context.billing_subject_id,
    )
    llm_balance = await agent_gateway_store.get_remaining_credit_usd(
        db,
        context.billing_subject_id,
    )

    compute_limit: BudgetLimitWindowUsage | None = None
    llm_limit: BudgetLimitWindowUsage | None = None
    if context.organization_id is not None:
        limits = await billing_store.list_budget_limits(db, context.organization_id)
        compute_limit = await _resolved_limit_usage(
            db,
            limits,
            billing_subject_id=context.billing_subject_id,
            user_id=user_id,
            kind="compute",
            now=now,
        )
        llm_limit = await _resolved_limit_usage(
            db,
            limits,
            billing_subject_id=context.billing_subject_id,
            user_id=user_id,
            kind="llm",
            now=now,
        )

    return UsageSummary(
        compute_used_seconds_mtd=compute_used_mtd,
        compute_remaining_seconds=snapshot.remaining_seconds,
        llm_used_usd_mtd=llm_used_mtd,
        llm_remaining_usd=float(llm_balance.remaining_usd),
        compute_limit=compute_limit,
        llm_limit=llm_limit,
        can_self_serve_top_up=_can_self_serve_top_up(context),
    )


async def _resolved_limit_usage(
    db: AsyncSession,
    limits: list[BillingBudgetLimit],
    *,
    billing_subject_id: UUID,
    user_id: UUID,
    kind: str,
    now: datetime,
) -> BudgetLimitWindowUsage | None:
    effective = resolve_effective_limit(limits, user_id=user_id, kind=kind)
    if effective is None:
        return None
    start, end = window_bounds(effective.window, now)
    # An org-wide limit (user_id is None) caps everyone's combined usage; a
    # per-user limit caps just that user. Usage is scoped to match.
    scope_user_id = user_id if effective.user_id is not None else None
    if kind == "compute":
        used = await billing_store.compute_usage_seconds_in_window(
            db,
            billing_subject_id=billing_subject_id,
            start=start,
            end=end,
            now=now,
            user_id=scope_user_id,
        )
    else:
        used = await agent_gateway_store.llm_cost_usd_in_window(
            db,
            billing_subject_id=billing_subject_id,
            start=start,
            end=end,
            user_id=scope_user_id,
        )
    return BudgetLimitWindowUsage(
        window=effective.window,
        cap_value=effective.cap_value,
        used_value=used,
        blocked=used >= effective.cap_value,
    )


def _can_self_serve_top_up(context: OwnerContext) -> bool:
    if context.owner_scope == "personal":
        return True
    return context.membership_role in (ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN)


async def get_usage_timeseries(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    granularity: str,
    days: int,
    kind: str,
    user_id: UUID | None = None,
) -> UsageTimeseries:
    now = utcnow()
    start = now - timedelta(days=days)
    buckets = bucket_starts(granularity, start, now)

    compute_by_bucket: dict[datetime, float] = {}
    llm_by_bucket: dict[datetime, float] = {}
    if kind in ("compute", "all"):
        rows = await billing_store.compute_usage_seconds_timeseries(
            db,
            billing_subject_id=billing_subject_id,
            granularity=granularity,
            start=start,
            end=now,
            now=now,
            user_id=user_id,
        )
        compute_by_bucket = dict(rows)
    if kind in ("llm", "all"):
        rows = await agent_gateway_store.llm_cost_usd_timeseries(
            db,
            billing_subject_id=billing_subject_id,
            granularity=granularity,
            start=start,
            end=now,
            user_id=user_id,
        )
        llm_by_bucket = dict(rows)

    return UsageTimeseries(
        buckets=[
            UsageTimeseriesBucket(
                bucket_start=bucket_start,
                compute_seconds=compute_by_bucket.get(bucket_start, 0.0),
                llm_cost_usd=llm_by_bucket.get(bucket_start, 0.0),
            )
            for bucket_start in buckets
        ]
    )


async def get_llm_balance(db: AsyncSession, context: OwnerContext) -> LlmBalance:
    balance = await agent_gateway_store.get_remaining_credit_usd(db, context.billing_subject_id)
    return LlmBalance(
        granted_usd=float(balance.granted_usd),
        used_usd=float(balance.used_usd),
        remaining_usd=float(balance.remaining_usd),
    )
