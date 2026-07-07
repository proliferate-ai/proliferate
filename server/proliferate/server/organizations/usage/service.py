"""Org-admin usage aggregation + budget-limit CRUD (spec §3.3-§3.6)."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import commit_session
from proliferate.db.models.billing import BillingBudgetLimit
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store import billing as billing_store
from proliferate.db.store import organizations as organization_store
from proliferate.errors import InvalidRequest
from proliferate.server.billing.budget_limits import (
    BUDGET_LIMIT_KINDS,
    BUDGET_LIMIT_WINDOWS,
    resolve_effective_limit,
)
from proliferate.server.billing.subjects import ensure_organization_billing_subject_state
from proliferate.server.billing.usage import get_usage_timeseries
from proliferate.server.organizations.usage.models import (
    BudgetLimit,
    BudgetLimitsResponse,
    OrgUsageByUserResponse,
    OrgUserUsageRow,
    OrgUserUsageTimeseriesResponse,
    PutBudgetLimitsRequest,
)
from proliferate.utils.time import utcnow


async def _org_billing_subject_id(db: AsyncSession, organization_id: UUID) -> UUID:
    state = await ensure_organization_billing_subject_state(db, organization_id)
    return state.billing_subject_id


async def get_usage_by_user(
    db: AsyncSession,
    organization_id: UUID,
    *,
    days: int,
) -> OrgUsageByUserResponse:
    now = utcnow()
    start = now - timedelta(days=days)
    billing_subject_id = await _org_billing_subject_id(db, organization_id)
    members = await organization_store.list_organization_members(db, organization_id)
    compute_by_user = await billing_store.compute_usage_seconds_by_user(
        db,
        billing_subject_id=billing_subject_id,
        start=start,
        end=now,
        now=now,
    )
    llm_by_user = await agent_gateway_store.llm_cost_usd_by_user(
        db,
        billing_subject_id=billing_subject_id,
        start=start,
        end=now,
    )
    limits = await billing_store.list_budget_limits(db, organization_id)

    rows = []
    for member in members:
        user_id = member.membership.user_id
        compute_seconds = compute_by_user.get(user_id, 0.0)
        llm_cost_usd = llm_by_user.get(user_id, 0.0)
        compute_limit = resolve_effective_limit(limits, user_id=user_id, kind="compute")
        llm_limit = resolve_effective_limit(limits, user_id=user_id, kind="llm")
        rows.append(
            OrgUserUsageRow(
                user_id=user_id,
                display_name=member.display_name,
                email=member.email,
                compute_seconds=compute_seconds,
                llm_cost_usd=llm_cost_usd,
                compute_limit_cap_seconds=(
                    compute_limit.cap_value if compute_limit is not None else None
                ),
                llm_limit_cap_usd=llm_limit.cap_value if llm_limit is not None else None,
            )
        )
    # Ranking only — seconds and USD are never added for display, but a single
    # descending sort by combined consumption is a reasonable "most active" proxy.
    rows.sort(key=lambda row: row.compute_seconds + row.llm_cost_usd, reverse=True)
    return OrgUsageByUserResponse(users=rows)


async def get_user_usage_timeseries(
    db: AsyncSession,
    organization_id: UUID,
    user_id: UUID,
    *,
    granularity: str,
    days: int,
    kind: str,
) -> OrgUserUsageTimeseriesResponse:
    billing_subject_id = await _org_billing_subject_id(db, organization_id)
    timeseries = await get_usage_timeseries(
        db,
        billing_subject_id=billing_subject_id,
        granularity=granularity,
        days=days,
        kind=kind,
        user_id=user_id,
    )
    return OrgUserUsageTimeseriesResponse(buckets=timeseries.buckets)


async def list_limits(db: AsyncSession, organization_id: UUID) -> BudgetLimitsResponse:
    rows = await billing_store.list_budget_limits(db, organization_id)
    return BudgetLimitsResponse(limits=[_budget_limit_from_row(row) for row in rows])


async def replace_limits(
    db: AsyncSession,
    organization_id: UUID,
    request: PutBudgetLimitsRequest,
) -> BudgetLimitsResponse:
    members = await organization_store.list_organization_members(db, organization_id)
    member_user_ids = {member.membership.user_id for member in members}

    seen: set[tuple[UUID | None, str, str]] = set()
    inputs: list[billing_store.BudgetLimitInput] = []
    for item in request.limits:
        if item.kind not in BUDGET_LIMIT_KINDS:
            raise InvalidRequest(
                f"Unsupported limit kind: {item.kind!r}",
                code="invalid_budget_limit_kind",
            )
        if item.window not in BUDGET_LIMIT_WINDOWS:
            raise InvalidRequest(
                f"Unsupported limit window: {item.window!r}",
                code="invalid_budget_limit_window",
            )
        if item.cap_value < 0:
            raise InvalidRequest(
                "Limit cap must be non-negative.",
                code="invalid_budget_limit_cap",
            )
        if item.user_id is not None and item.user_id not in member_user_ids:
            raise InvalidRequest(
                "userId is not a member of this organization.",
                code="invalid_budget_limit_user",
            )
        key = (item.user_id, item.kind, item.window)
        if key in seen:
            raise InvalidRequest(
                "Duplicate limit for the same user/kind/window.",
                code="duplicate_budget_limit",
            )
        seen.add(key)
        inputs.append(
            billing_store.BudgetLimitInput(
                user_id=item.user_id,
                kind=item.kind,
                window=item.window,
                cap_value=Decimal(str(item.cap_value)),
                enabled=item.enabled,
            )
        )

    rows = await billing_store.replace_budget_limits(
        db,
        organization_id=organization_id,
        limits=inputs,
    )
    await commit_session(db)
    return BudgetLimitsResponse(limits=[_budget_limit_from_row(row) for row in rows])


def _budget_limit_from_row(row: BillingBudgetLimit) -> BudgetLimit:
    return BudgetLimit(
        id=row.id,
        user_id=row.user_id,
        kind=row.kind,
        window=row.window,
        cap_value=float(row.cap_value),
        enabled=row.enabled,
        updated_at=row.updated_at,
    )
