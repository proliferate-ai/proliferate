"""Usage-aggregate + budget-limit store tests (real Postgres via db_session)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.models.billing import UsageSegment
from proliferate.db.models.cloud.agent_gateway import AgentLlmUsageEvent
from proliferate.db.models.organizations import Organization
from proliferate.db.store import billing as billing_store
from proliferate.db.store.agent_gateway import usage as llm_usage_store
from proliferate.db.store.billing import BudgetLimitInput
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject
from proliferate.server.billing.budget_limits import window_bounds

NOW = datetime(2026, 7, 7, 12, 0, tzinfo=UTC)


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"usage-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


async def _create_org(db_session: AsyncSession) -> uuid.UUID:
    org = Organization(name=f"org-{uuid.uuid4().hex[:8]}", status="active")
    db_session.add(org)
    await db_session.flush()
    return org.id


def _segment(
    *,
    subject_id: uuid.UUID,
    user_id: uuid.UUID,
    started_at: datetime,
    ended_at: datetime | None,
    is_billable: bool = True,
) -> UsageSegment:
    return UsageSegment(
        user_id=user_id,
        billing_subject_id=subject_id,
        workspace_id=uuid.uuid4(),
        sandbox_id=uuid.uuid4(),
        external_sandbox_id=f"sandbox-{uuid.uuid4().hex[:8]}",
        started_at=started_at,
        ended_at=ended_at,
        is_billable=is_billable,
        opened_by="provision",
        closed_by="manual_stop" if ended_at is not None else None,
    )


def _llm_event(
    *,
    subject_id: uuid.UUID,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    occurred_at: datetime,
    cost: float,
) -> AgentLlmUsageEvent:
    return AgentLlmUsageEvent(
        litellm_request_id=f"req-{uuid.uuid4().hex}",
        user_id=user_id,
        organization_id=org_id,
        billing_subject_id=subject_id,
        model="claude-sonnet-4-5",
        prompt_tokens=100,
        completion_tokens=20,
        total_tokens=120,
        cost_usd=cost,
        status="imported",
        occurred_at=occurred_at,
    )


async def _seed(db_session: AsyncSession):
    org_id = await _create_org(db_session)
    subject = await ensure_organization_billing_subject(db_session, org_id)
    user_a = await _create_user(db_session)
    user_b = await _create_user(db_session)

    db_session.add_all(
        [
            # user_a: 07-05 → 3600s (closed)
            _segment(
                subject_id=subject.id,
                user_id=user_a,
                started_at=datetime(2026, 7, 5, 10, 0, tzinfo=UTC),
                ended_at=datetime(2026, 7, 5, 11, 0, tzinfo=UTC),
            ),
            # user_a: 07-06 → 1800s (closed)
            _segment(
                subject_id=subject.id,
                user_id=user_a,
                started_at=datetime(2026, 7, 6, 10, 0, tzinfo=UTC),
                ended_at=datetime(2026, 7, 6, 10, 30, tzinfo=UTC),
            ),
            # user_b: 07-06 → 900s (closed)
            _segment(
                subject_id=subject.id,
                user_id=user_b,
                started_at=datetime(2026, 7, 6, 9, 0, tzinfo=UTC),
                ended_at=datetime(2026, 7, 6, 9, 15, tzinfo=UTC),
            ),
            # user_a: 07-07 open → clipped at NOW (11:00→12:00) = 3600s
            _segment(
                subject_id=subject.id,
                user_id=user_a,
                started_at=datetime(2026, 7, 7, 11, 0, tzinfo=UTC),
                ended_at=None,
            ),
            # non-billable is excluded entirely
            _segment(
                subject_id=subject.id,
                user_id=user_a,
                started_at=datetime(2026, 7, 5, 0, 0, tzinfo=UTC),
                ended_at=datetime(2026, 7, 5, 5, 0, tzinfo=UTC),
                is_billable=False,
            ),
            _llm_event(
                subject_id=subject.id,
                org_id=org_id,
                user_id=user_a,
                occurred_at=datetime(2026, 7, 5, 10, 0, tzinfo=UTC),
                cost=1.00,
            ),
            _llm_event(
                subject_id=subject.id,
                org_id=org_id,
                user_id=user_a,
                occurred_at=datetime(2026, 7, 6, 10, 0, tzinfo=UTC),
                cost=2.00,
            ),
            _llm_event(
                subject_id=subject.id,
                org_id=org_id,
                user_id=user_b,
                occurred_at=datetime(2026, 7, 6, 9, 0, tzinfo=UTC),
                cost=0.50,
            ),
            _llm_event(
                subject_id=subject.id,
                org_id=org_id,
                user_id=user_a,
                occurred_at=datetime(2026, 7, 7, 11, 0, tzinfo=UTC),
                cost=0.25,
            ),
        ]
    )
    await db_session.flush()
    return org_id, subject.id, user_a, user_b


@pytest.mark.asyncio
async def test_compute_timeseries_buckets_by_started_at_and_clips_open(
    db_session: AsyncSession,
) -> None:
    _, subject_id, _, _ = await _seed(db_session)
    start = datetime(2026, 7, 5, tzinfo=UTC)
    end = datetime(2026, 7, 8, tzinfo=UTC)

    rows = await billing_store.compute_usage_seconds_timeseries(
        db_session,
        billing_subject_id=subject_id,
        granularity="day",
        start=start,
        end=end,
        now=NOW,
    )
    buckets = {bucket: seconds for bucket, seconds in rows}
    assert buckets[datetime(2026, 7, 5, tzinfo=UTC)] == pytest.approx(3600.0)
    assert buckets[datetime(2026, 7, 6, tzinfo=UTC)] == pytest.approx(2700.0)
    assert buckets[datetime(2026, 7, 7, tzinfo=UTC)] == pytest.approx(3600.0)
    # sorted ascending
    assert [bucket for bucket, _ in rows] == sorted(bucket for bucket, _ in rows)


@pytest.mark.asyncio
async def test_compute_timeseries_user_filter(db_session: AsyncSession) -> None:
    _, subject_id, user_a, _ = await _seed(db_session)
    rows = await billing_store.compute_usage_seconds_timeseries(
        db_session,
        billing_subject_id=subject_id,
        granularity="day",
        start=datetime(2026, 7, 6, tzinfo=UTC),
        end=datetime(2026, 7, 7, tzinfo=UTC),
        now=NOW,
        user_id=user_a,
    )
    buckets = {bucket: seconds for bucket, seconds in rows}
    assert buckets == {datetime(2026, 7, 6, tzinfo=UTC): pytest.approx(1800.0)}


@pytest.mark.asyncio
async def test_compute_by_user_and_window(db_session: AsyncSession) -> None:
    _, subject_id, user_a, user_b = await _seed(db_session)
    start, end = window_bounds("month", NOW)

    by_user = await billing_store.compute_usage_seconds_by_user(
        db_session, billing_subject_id=subject_id, start=start, end=end, now=NOW
    )
    assert by_user[user_a] == pytest.approx(9000.0)
    assert by_user[user_b] == pytest.approx(900.0)

    org_wide = await billing_store.compute_usage_seconds_in_window(
        db_session, billing_subject_id=subject_id, start=start, end=end, now=NOW
    )
    assert org_wide == pytest.approx(9900.0)

    only_a = await billing_store.compute_usage_seconds_in_window(
        db_session, billing_subject_id=subject_id, start=start, end=end, now=NOW, user_id=user_a
    )
    assert only_a == pytest.approx(9000.0)


@pytest.mark.asyncio
async def test_compute_window_zero_for_user_without_usage(db_session: AsyncSession) -> None:
    _, subject_id, _, _ = await _seed(db_session)
    start, end = window_bounds("month", NOW)
    stranger = await _create_user(db_session)
    total = await billing_store.compute_usage_seconds_in_window(
        db_session, billing_subject_id=subject_id, start=start, end=end, now=NOW, user_id=stranger
    )
    assert total == 0.0


@pytest.mark.asyncio
async def test_compute_window_zero_for_empty_subject(db_session: AsyncSession) -> None:
    total = await billing_store.compute_usage_seconds_in_window(
        db_session,
        billing_subject_id=uuid.uuid4(),
        start=datetime(2026, 7, 1, tzinfo=UTC),
        end=datetime(2026, 8, 1, tzinfo=UTC),
        now=NOW,
    )
    assert total == 0.0


@pytest.mark.asyncio
async def test_llm_timeseries_by_user_and_window(db_session: AsyncSession) -> None:
    _, subject_id, user_a, user_b = await _seed(db_session)

    rows = await llm_usage_store.llm_cost_usd_timeseries(
        db_session,
        billing_subject_id=subject_id,
        granularity="day",
        start=datetime(2026, 7, 5, tzinfo=UTC),
        end=datetime(2026, 7, 8, tzinfo=UTC),
    )
    buckets = {bucket: cost for bucket, cost in rows}
    assert buckets[datetime(2026, 7, 5, tzinfo=UTC)] == pytest.approx(1.00)
    assert buckets[datetime(2026, 7, 6, tzinfo=UTC)] == pytest.approx(2.50)
    assert buckets[datetime(2026, 7, 7, tzinfo=UTC)] == pytest.approx(0.25)

    start, end = window_bounds("month", NOW)
    by_user = await llm_usage_store.llm_cost_usd_by_user(
        db_session, billing_subject_id=subject_id, start=start, end=end
    )
    assert by_user[user_a] == pytest.approx(3.25)
    assert by_user[user_b] == pytest.approx(0.50)

    org_wide = await llm_usage_store.llm_cost_usd_in_window(
        db_session, billing_subject_id=subject_id, start=start, end=end
    )
    assert org_wide == pytest.approx(3.75)

    only_a = await llm_usage_store.llm_cost_usd_in_window(
        db_session, billing_subject_id=subject_id, start=start, end=end, user_id=user_a
    )
    assert only_a == pytest.approx(3.25)


@pytest.mark.asyncio
async def test_llm_window_zero_for_empty_subject(db_session: AsyncSession) -> None:
    total = await llm_usage_store.llm_cost_usd_in_window(
        db_session,
        billing_subject_id=uuid.uuid4(),
        start=datetime(2026, 7, 1, tzinfo=UTC),
        end=datetime(2026, 8, 1, tzinfo=UTC),
    )
    assert total == 0.0


@pytest.mark.asyncio
async def test_budget_limit_crud_full_replace(db_session: AsyncSession) -> None:
    org_id, _, user_a, _ = await _seed(db_session)

    assert await billing_store.list_budget_limits(db_session, org_id) == []

    first = await billing_store.replace_budget_limits(
        db_session,
        organization_id=org_id,
        limits=[
            BudgetLimitInput(
                user_id=None,
                kind="compute",
                window="month",
                cap_value=Decimal("72000"),
                enabled=True,
            ),
            BudgetLimitInput(
                user_id=user_a,
                kind="llm",
                window="month",
                cap_value=Decimal("10.00"),
                enabled=True,
            ),
        ],
    )
    assert len(first) == 2
    org_wide = next(limit for limit in first if limit.user_id is None)
    assert org_wide.kind == "compute"
    assert org_wide.cap_value == Decimal("72000.00")
    assert org_wide.enabled is True

    listed = await billing_store.list_budget_limits(db_session, org_id)
    assert len(listed) == 2
    # org-wide row sorts first
    assert listed[0].user_id is None

    # Full-replace drops the previous set entirely.
    second = await billing_store.replace_budget_limits(
        db_session,
        organization_id=org_id,
        limits=[
            BudgetLimitInput(
                user_id=None, kind="llm", window="day", cap_value=Decimal("5"), enabled=False
            ),
        ],
    )
    assert len(second) == 1
    assert second[0].kind == "llm"
    assert second[0].window == "day"
    assert second[0].enabled is False
    assert await billing_store.list_budget_limits(db_session, org_id) == second


@pytest.mark.asyncio
async def test_budget_limit_replace_empty_clears(db_session: AsyncSession) -> None:
    org_id, _, _, _ = await _seed(db_session)
    await billing_store.replace_budget_limits(
        db_session,
        organization_id=org_id,
        limits=[
            BudgetLimitInput(
                user_id=None,
                kind="compute",
                window="month",
                cap_value=Decimal("100"),
                enabled=True,
            )
        ],
    )
    cleared = await billing_store.replace_budget_limits(
        db_session, organization_id=org_id, limits=[]
    )
    assert cleared == []
    assert await billing_store.list_budget_limits(db_session, org_id) == []
