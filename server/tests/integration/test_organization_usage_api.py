"""Integration tests for org-admin usage visibility + budget-limit CRUD (spec §3.3-§3.6)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.billing import BillingBudgetLimit, UsageSegment
from proliferate.db.models.cloud.agent_gateway import AgentLlmUsageEvent
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject
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
                    display_name="Org Usage Tester",
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
        state_prefix="org-usage-state",
    )
    return {"user_id": user_id, "access_token": str(token_data["access_token"])}


def _headers(session: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {session['access_token']}"}


async def _create_org_with_owner_and_member(
    db_session: AsyncSession,
    *,
    owner_id: uuid.UUID,
    member_id: uuid.UUID,
    name: str,
) -> Organization:
    now = datetime.now(UTC)
    organization = Organization(name=name)
    db_session.add(organization)
    await db_session.flush()
    db_session.add_all(
        [
            OrganizationMembership(
                organization_id=organization.id,
                user_id=owner_id,
                role=ORGANIZATION_ROLE_OWNER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                joined_at=now,
            ),
            OrganizationMembership(
                organization_id=organization.id,
                user_id=member_id,
                role=ORGANIZATION_ROLE_MEMBER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                joined_at=now,
            ),
        ]
    )
    await ensure_organization_billing_subject(db_session, organization.id)
    await db_session.commit()
    return organization


@pytest.mark.asyncio
async def test_usage_by_user_forbidden_for_non_admin_member(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner_session = await _register_and_login(client, "org-usage-owner1@example.com")
    member_session = await _register_and_login(client, "org-usage-member1@example.com")
    organization = await _create_org_with_owner_and_member(
        db_session,
        owner_id=uuid.UUID(owner_session["user_id"]),
        member_id=uuid.UUID(member_session["user_id"]),
        name="Usage By User Org",
    )

    response = await client.get(
        f"/v1/organizations/{organization.id}/usage/by-user",
        headers=_headers(member_session),
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "organization_permission_denied"


@pytest.mark.asyncio
async def test_usage_by_user_admin_includes_zero_usage_members_and_limit_caps(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner_session = await _register_and_login(client, "org-usage-owner2@example.com")
    member_session = await _register_and_login(client, "org-usage-member2@example.com")
    owner_id = uuid.UUID(owner_session["user_id"])
    member_id = uuid.UUID(member_session["user_id"])
    organization = await _create_org_with_owner_and_member(
        db_session,
        owner_id=owner_id,
        member_id=member_id,
        name="Usage By User Caps Org",
    )
    subject = await ensure_organization_billing_subject(db_session, organization.id)
    now = datetime.now(UTC)
    db_session.add_all(
        [
            UsageSegment(
                user_id=member_id,
                billing_subject_id=subject.id,
                organization_id=organization.id,
                workspace_id=uuid.uuid4(),
                sandbox_id=uuid.uuid4(),
                external_sandbox_id=f"sandbox-{uuid.uuid4().hex[:8]}",
                started_at=now - timedelta(hours=1),
                ended_at=now - timedelta(minutes=30),
                is_billable=True,
                opened_by="provision",
                closed_by="manual_stop",
            ),
            AgentLlmUsageEvent(
                litellm_request_id=f"req-{uuid.uuid4().hex}",
                user_id=member_id,
                organization_id=organization.id,
                billing_subject_id=subject.id,
                model="claude-sonnet-4-5",
                prompt_tokens=10,
                completion_tokens=5,
                total_tokens=15,
                cost_usd=3.0,
                status="imported",
                occurred_at=now - timedelta(minutes=30),
            ),
            BillingBudgetLimit(
                organization_id=organization.id,
                user_id=member_id,
                kind="compute",
                window="month",
                cap_value=Decimal("7200.00"),
                enabled=True,
            ),
        ]
    )
    await db_session.commit()

    response = await client.get(
        f"/v1/organizations/{organization.id}/usage/by-user",
        headers=_headers(owner_session),
        params={"days": 30},
    )

    assert response.status_code == 200
    users = response.json()["users"]
    assert {row["userId"] for row in users} == {str(owner_id), str(member_id)}
    member_row = next(row for row in users if row["userId"] == str(member_id))
    assert member_row["computeSeconds"] == 1800.0
    assert member_row["llmCostUsd"] == 3.0
    assert member_row["computeLimitCapSeconds"] == 7200.0
    assert member_row["llmLimitCapUsd"] is None
    owner_row = next(row for row in users if row["userId"] == str(owner_id))
    assert owner_row["computeSeconds"] == 0.0
    assert owner_row["llmCostUsd"] == 0.0
    # Sorted by combined consumption descending.
    assert users[0]["userId"] == str(member_id)


@pytest.mark.asyncio
async def test_user_usage_timeseries_admin_scoped_to_one_user(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner_session = await _register_and_login(client, "org-usage-owner3@example.com")
    member_session = await _register_and_login(client, "org-usage-member3@example.com")
    owner_id = uuid.UUID(owner_session["user_id"])
    member_id = uuid.UUID(member_session["user_id"])
    organization = await _create_org_with_owner_and_member(
        db_session,
        owner_id=owner_id,
        member_id=member_id,
        name="Per User Timeseries Org",
    )
    subject = await ensure_organization_billing_subject(db_session, organization.id)
    now = datetime.now(UTC)
    db_session.add_all(
        [
            UsageSegment(
                user_id=member_id,
                billing_subject_id=subject.id,
                workspace_id=uuid.uuid4(),
                sandbox_id=uuid.uuid4(),
                external_sandbox_id=f"sandbox-{uuid.uuid4().hex[:8]}",
                started_at=now - timedelta(minutes=20),
                ended_at=now - timedelta(minutes=10),
                is_billable=True,
                opened_by="provision",
                closed_by="manual_stop",
            ),
            UsageSegment(
                user_id=owner_id,
                billing_subject_id=subject.id,
                workspace_id=uuid.uuid4(),
                sandbox_id=uuid.uuid4(),
                external_sandbox_id=f"sandbox-{uuid.uuid4().hex[:8]}",
                started_at=now - timedelta(minutes=20),
                ended_at=now - timedelta(minutes=10),
                is_billable=True,
                opened_by="provision",
                closed_by="manual_stop",
            ),
        ]
    )
    await db_session.commit()

    response = await client.get(
        f"/v1/organizations/{organization.id}/usage/users/{member_id}/timeseries",
        headers=_headers(owner_session),
        params={"granularity": "day", "days": 7, "kind": "compute"},
    )

    assert response.status_code == 200
    buckets = response.json()["buckets"]
    assert buckets[-1]["computeSeconds"] == 600.0
    # Only the member's segment counts, not the owner's identical one.
    assert sum(b["computeSeconds"] for b in buckets) == 600.0


@pytest.mark.asyncio
async def test_limits_crud_round_trip_full_replace(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner_session = await _register_and_login(client, "org-limits-owner1@example.com")
    member_session = await _register_and_login(client, "org-limits-member1@example.com")
    owner_id = uuid.UUID(owner_session["user_id"])
    member_id = uuid.UUID(member_session["user_id"])
    organization = await _create_org_with_owner_and_member(
        db_session,
        owner_id=owner_id,
        member_id=member_id,
        name="Limits CRUD Org",
    )

    empty = await client.get(
        f"/v1/organizations/{organization.id}/limits",
        headers=_headers(owner_session),
    )
    assert empty.status_code == 200
    assert empty.json() == {"limits": []}

    put_response = await client.put(
        f"/v1/organizations/{organization.id}/limits",
        headers=_headers(owner_session),
        json={
            "limits": [
                {
                    "userId": None,
                    "kind": "llm",
                    "window": "month",
                    "capValue": 50.0,
                    "enabled": True,
                },
                {
                    "userId": str(member_id),
                    "kind": "compute",
                    "window": "day",
                    "capValue": 3600.0,
                    "enabled": True,
                },
            ]
        },
    )
    assert put_response.status_code == 200
    limits = put_response.json()["limits"]
    assert len(limits) == 2
    for row in limits:
        assert set(row.keys()) == {
            "id",
            "userId",
            "kind",
            "window",
            "capValue",
            "enabled",
            "updatedAt",
        }

    get_after_put = await client.get(
        f"/v1/organizations/{organization.id}/limits",
        headers=_headers(owner_session),
    )
    assert get_after_put.status_code == 200
    assert len(get_after_put.json()["limits"]) == 2

    replace_response = await client.put(
        f"/v1/organizations/{organization.id}/limits",
        headers=_headers(owner_session),
        json={
            "limits": [
                {"userId": None, "kind": "compute", "window": "month", "capValue": 36000.0},
            ]
        },
    )
    assert replace_response.status_code == 200
    replaced = replace_response.json()["limits"]
    assert len(replaced) == 1
    assert replaced[0]["kind"] == "compute"
    assert replaced[0]["capValue"] == 36000.0


@pytest.mark.asyncio
async def test_limits_put_requires_admin(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner_session = await _register_and_login(client, "org-limits-owner2@example.com")
    member_session = await _register_and_login(client, "org-limits-member2@example.com")
    organization = await _create_org_with_owner_and_member(
        db_session,
        owner_id=uuid.UUID(owner_session["user_id"]),
        member_id=uuid.UUID(member_session["user_id"]),
        name="Limits Admin Gate Org",
    )

    response = await client.put(
        f"/v1/organizations/{organization.id}/limits",
        headers=_headers(member_session),
        json={"limits": []},
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_limits_put_validates_kind_window_cap_and_membership(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    owner_session = await _register_and_login(client, "org-limits-owner3@example.com")
    member_session = await _register_and_login(client, "org-limits-member3@example.com")
    organization = await _create_org_with_owner_and_member(
        db_session,
        owner_id=uuid.UUID(owner_session["user_id"]),
        member_id=uuid.UUID(member_session["user_id"]),
        name="Limits Validation Org",
    )
    outsider_id = uuid.uuid4()

    bad_kind = await client.put(
        f"/v1/organizations/{organization.id}/limits",
        headers=_headers(owner_session),
        json={"limits": [{"userId": None, "kind": "bogus", "window": "month", "capValue": 1.0}]},
    )
    assert bad_kind.status_code in (400, 422)

    bad_window = await client.put(
        f"/v1/organizations/{organization.id}/limits",
        headers=_headers(owner_session),
        json={"limits": [{"userId": None, "kind": "llm", "window": "year", "capValue": 1.0}]},
    )
    assert bad_window.status_code in (400, 422)

    negative_cap = await client.put(
        f"/v1/organizations/{organization.id}/limits",
        headers=_headers(owner_session),
        json={"limits": [{"userId": None, "kind": "llm", "window": "month", "capValue": -1.0}]},
    )
    assert negative_cap.status_code == 400

    unknown_user = await client.put(
        f"/v1/organizations/{organization.id}/limits",
        headers=_headers(owner_session),
        json={
            "limits": [
                {"userId": str(outsider_id), "kind": "llm", "window": "month", "capValue": 1.0},
            ]
        },
    )
    assert unknown_user.status_code == 400
    assert unknown_user.json()["detail"]["code"] == "invalid_budget_limit_user"

    duplicate_scope = await client.put(
        f"/v1/organizations/{organization.id}/limits",
        headers=_headers(owner_session),
        json={
            "limits": [
                {"userId": None, "kind": "llm", "window": "month", "capValue": 1.0},
                {"userId": None, "kind": "llm", "window": "month", "capValue": 2.0},
            ]
        },
    )
    assert duplicate_scope.status_code == 400
    assert duplicate_scope.json()["detail"]["code"] == "duplicate_budget_limit"
