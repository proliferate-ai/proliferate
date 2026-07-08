"""Integration tests for the personal usage read endpoints (spec §3.1, §3.2, §3.5)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.agent_gateway import LLM_CREDIT_SOURCE_FREE_SIGNUP
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_ADMIN,
    ORGANIZATION_ROLE_MEMBER,
)
from proliferate.db.models.billing import BillingBudgetLimit, UsageSegment
from proliferate.db.models.cloud.agent_gateway import AgentLlmUsageEvent
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.agent_gateway.credits import create_llm_credit_grant
from proliferate.db.store.billing_subjects import (
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from tests.helpers.desktop_auth import mint_desktop_token_payload


async def _register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager, get_user_db
    from proliferate.db.engine import get_async_session
    from proliferate.db.models.auth import OAuthAccount

    user_id: str | None = None
    async for session in get_async_session():
        async for user_db in get_user_db(session):
            manager = UserManager(user_db)
            user = await manager.create(
                UserCreate(
                    email=email,
                    password="unused-oauth-only",
                    display_name="Usage Tester",
                ),
            )
            session.add(
                OAuthAccount(
                    user_id=user.id,
                    oauth_name="github",
                    access_token="github-access-token",
                    account_id=f"github-{user.id}",
                    account_email=email,
                )
            )
            await session.commit()
            user_id = str(user.id)

    assert user_id is not None
    token_data = await mint_desktop_token_payload(
        client,
        user_id=user_id,
        state_prefix="usage-state",
    )
    return {"user_id": user_id, "access_token": str(token_data["access_token"])}


def _headers(session: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {session['access_token']}"}


@pytest.mark.asyncio
async def test_usage_summary_personal_scope_defaults_and_self_serve_top_up(
    client: AsyncClient,
) -> None:
    session = await _register_and_login(client, "usage-summary-empty@example.com")

    response = await client.get("/v1/billing/usage/summary", headers=_headers(session))

    assert response.status_code == 200
    body = response.json()
    assert body["computeUsedSecondsMtd"] == 0.0
    assert body["llmUsedUsdMtd"] == 0.0
    assert body["llmRemainingUsd"] == 0.0
    assert body["computeLimit"] is None
    assert body["llmLimit"] is None
    assert body["canSelfServeTopUp"] is True


@pytest.mark.asyncio
async def test_usage_summary_reflects_mtd_usage_and_llm_balance(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    session = await _register_and_login(client, "usage-summary-seeded@example.com")
    user_id = uuid.UUID(session["user_id"])
    subject = await ensure_personal_billing_subject(db_session, user_id)
    now = datetime.now(UTC)

    db_session.add(
        UsageSegment(
            user_id=user_id,
            billing_subject_id=subject.id,
            workspace_id=uuid.uuid4(),
            sandbox_id=uuid.uuid4(),
            external_sandbox_id=f"sandbox-{uuid.uuid4().hex[:8]}",
            started_at=now - timedelta(hours=2),
            ended_at=now - timedelta(hours=1),
            is_billable=True,
            opened_by="provision",
            closed_by="manual_stop",
        )
    )
    db_session.add(
        AgentLlmUsageEvent(
            litellm_request_id=f"req-{uuid.uuid4().hex}",
            user_id=user_id,
            billing_subject_id=subject.id,
            model="claude-sonnet-4-5",
            prompt_tokens=100,
            completion_tokens=20,
            total_tokens=120,
            cost_usd=2.5,
            status="imported",
            occurred_at=now - timedelta(hours=1),
        )
    )
    await db_session.commit()
    await create_llm_credit_grant(
        db_session,
        billing_subject_id=subject.id,
        source=LLM_CREDIT_SOURCE_FREE_SIGNUP,
        amount_usd=Decimal("10.00"),
    )
    await db_session.commit()

    response = await client.get("/v1/billing/usage/summary", headers=_headers(session))

    assert response.status_code == 200
    body = response.json()
    assert body["computeUsedSecondsMtd"] == 3600.0
    assert body["llmUsedUsdMtd"] == 2.5
    assert body["llmRemainingUsd"] == 7.5


@pytest.mark.asyncio
async def test_usage_timeseries_zero_fills_missing_buckets(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    session = await _register_and_login(client, "usage-timeseries@example.com")
    user_id = uuid.UUID(session["user_id"])
    subject = await ensure_personal_billing_subject(db_session, user_id)
    now = datetime.now(UTC)

    db_session.add(
        UsageSegment(
            user_id=user_id,
            billing_subject_id=subject.id,
            workspace_id=uuid.uuid4(),
            sandbox_id=uuid.uuid4(),
            external_sandbox_id=f"sandbox-{uuid.uuid4().hex[:8]}",
            started_at=now - timedelta(minutes=30),
            ended_at=now - timedelta(minutes=10),
            is_billable=True,
            opened_by="provision",
            closed_by="manual_stop",
        )
    )
    await db_session.commit()

    response = await client.get(
        "/v1/billing/usage/timeseries",
        headers=_headers(session),
        params={"granularity": "day", "days": 7, "kind": "all"},
    )

    assert response.status_code == 200
    buckets = response.json()["buckets"]
    assert len(buckets) >= 7
    starts = [b["bucketStart"] for b in buckets]
    assert starts == sorted(starts)
    today_bucket = buckets[-1]
    assert today_bucket["computeSeconds"] == 1200.0
    assert today_bucket["llmCostUsd"] == 0.0
    assert sum(b["computeSeconds"] for b in buckets[:-1]) == 0.0


@pytest.mark.asyncio
async def test_usage_timeseries_kind_filter_excludes_other_meter(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    session = await _register_and_login(client, "usage-timeseries-kind@example.com")
    user_id = uuid.UUID(session["user_id"])
    subject = await ensure_personal_billing_subject(db_session, user_id)
    now = datetime.now(UTC)
    db_session.add(
        AgentLlmUsageEvent(
            litellm_request_id=f"req-{uuid.uuid4().hex}",
            user_id=user_id,
            billing_subject_id=subject.id,
            model="claude-sonnet-4-5",
            prompt_tokens=10,
            completion_tokens=5,
            total_tokens=15,
            cost_usd=1.25,
            status="imported",
            occurred_at=now - timedelta(minutes=5),
        )
    )
    await db_session.commit()

    compute_only = await client.get(
        "/v1/billing/usage/timeseries",
        headers=_headers(session),
        params={"granularity": "day", "days": 7, "kind": "compute"},
    )
    assert compute_only.status_code == 200
    assert all(b["llmCostUsd"] == 0.0 for b in compute_only.json()["buckets"])

    llm_only = await client.get(
        "/v1/billing/usage/timeseries",
        headers=_headers(session),
        params={"granularity": "day", "days": 7, "kind": "llm"},
    )
    assert llm_only.status_code == 200
    assert llm_only.json()["buckets"][-1]["llmCostUsd"] == 1.25


@pytest.mark.asyncio
async def test_llm_balance_endpoint_matches_grants_minus_usage(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    session = await _register_and_login(client, "usage-llm-balance@example.com")
    user_id = uuid.UUID(session["user_id"])
    subject = await ensure_personal_billing_subject(db_session, user_id)
    await create_llm_credit_grant(
        db_session,
        billing_subject_id=subject.id,
        source=LLM_CREDIT_SOURCE_FREE_SIGNUP,
        amount_usd=Decimal("10.00"),
    )
    db_session.add(
        AgentLlmUsageEvent(
            litellm_request_id=f"req-{uuid.uuid4().hex}",
            user_id=user_id,
            billing_subject_id=subject.id,
            model="claude-sonnet-4-5",
            prompt_tokens=10,
            completion_tokens=5,
            total_tokens=15,
            cost_usd=4.0,
            status="imported",
            occurred_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    response = await client.get("/v1/billing/llm-balance", headers=_headers(session))

    assert response.status_code == 200
    assert response.json() == {"grantedUsd": 10.0, "usedUsd": 4.0, "remainingUsd": 6.0}


@pytest.mark.asyncio
async def test_usage_summary_org_scope_resolves_tightest_limit_and_blocks(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner_session = await _register_and_login(client, "usage-summary-org-owner@example.com")
    owner_id = uuid.UUID(owner_session["user_id"])
    now = datetime.now(UTC)

    organization = Organization(name="Usage Summary Org")
    db_session.add(organization)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=owner_id,
            role=ORGANIZATION_ROLE_ADMIN,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
        )
    )
    subject = await ensure_organization_billing_subject(db_session, organization.id)
    db_session.add_all(
        [
            BillingBudgetLimit(
                organization_id=organization.id,
                user_id=None,
                kind="compute",
                window="month",
                cap_value=Decimal("36000.00"),
                enabled=True,
            ),
            BillingBudgetLimit(
                organization_id=organization.id,
                user_id=owner_id,
                kind="compute",
                window="month",
                cap_value=Decimal("1800.00"),
                enabled=True,
            ),
            UsageSegment(
                user_id=owner_id,
                billing_subject_id=subject.id,
                workspace_id=uuid.uuid4(),
                sandbox_id=uuid.uuid4(),
                external_sandbox_id=f"sandbox-{uuid.uuid4().hex[:8]}",
                started_at=now - timedelta(hours=1),
                ended_at=now - timedelta(minutes=30),
                is_billable=True,
                opened_by="provision",
                closed_by="manual_stop",
            ),
        ]
    )
    await db_session.commit()

    response = await client.get(
        "/v1/billing/usage/summary",
        headers=_headers(owner_session),
        params={"ownerScope": "organization", "organizationId": str(organization.id)},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["computeLimit"] == {
        "window": "month",
        "capValue": 1800.0,
        "usedValue": 1800.0,
        "blocked": True,
    }
    assert body["canSelfServeTopUp"] is True


@pytest.mark.asyncio
async def test_usage_summary_org_member_cannot_self_serve_top_up(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    member_session = await _register_and_login(client, "usage-summary-org-member@example.com")
    member_id = uuid.UUID(member_session["user_id"])
    now = datetime.now(UTC)

    organization = Organization(name="Usage Summary Member Org")
    db_session.add(organization)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=member_id,
            role=ORGANIZATION_ROLE_MEMBER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
        )
    )
    await ensure_organization_billing_subject(db_session, organization.id)
    await db_session.commit()

    response = await client.get(
        "/v1/billing/usage/summary",
        headers=_headers(member_session),
        params={"ownerScope": "organization", "organizationId": str(organization.id)},
    )

    assert response.status_code == 200
    assert response.json()["canSelfServeTopUp"] is False
