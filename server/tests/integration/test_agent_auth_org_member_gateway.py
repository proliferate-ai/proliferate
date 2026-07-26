"""Org-member gateway resolution (model-gateway.md org-member gap, closed by B3).

Before this fix, an org member's gateway sessions always resolved their
PERSONAL enrollment (state renderer and budget gate both called
``get_enrollment_for_user`` unconditionally), so org members' gateway spend
landed on their personal subject rather than the org's. These tests prove the
fix: for a user with a current org membership, both
``is_gateway_budget_available`` and the agent-auth state renderer resolve the
ORG enrollment's key/budget, not the personal one.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import LLM_CREDIT_SOURCE_ADMIN
from proliferate.db.models.auth import User
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.agent_gateway import DesiredAuthSource
from proliferate.db.store.agent_gateway.selections import put_auth_selections
from proliferate.server.cloud.agent_gateway.budget import (
    get_gateway_enrollment_for_user,
    is_gateway_budget_available,
)
from proliferate.server.cloud.agent_gateway.enrollment import (
    ensure_org_enrollment,
    ensure_user_enrollment,
)
from proliferate.server.cloud.materialization.materialize.agent_auth import (
    build_agent_auth_state,
)
from tests.integration.agent_gateway_topups_shared import StubLiteLLM


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"org-member-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


async def _create_org_with_active_member(
    db_session: AsyncSession, *, user_id: uuid.UUID
) -> uuid.UUID:
    organization = Organization(name=f"Gateway Org {uuid.uuid4().hex[:6]}")
    db_session.add(organization)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=user_id,
            role="member",
            status="active",
        )
    )
    await db_session.flush()
    return organization.id


@pytest.mark.asyncio
async def test_org_member_gateway_governed_by_org_enrollment_not_personal(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """The resolved enrollment for a current org member is the org one."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    personal = await ensure_user_enrollment(db_session, user_id)
    org_enrollment = await ensure_org_enrollment(db_session, org_id, user_id)
    assert personal.id != org_enrollment.id

    resolved = await get_gateway_enrollment_for_user(db_session, user_id)
    assert resolved is not None
    assert resolved.id == org_enrollment.id
    assert resolved.subject_kind == "organization"


@pytest.mark.asyncio
async def test_org_less_user_still_resolves_personal_enrollment(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    user_id = await _create_user(db_session)

    personal = await ensure_user_enrollment(db_session, user_id)

    resolved = await get_gateway_enrollment_for_user(db_session, user_id)
    assert resolved is not None
    assert resolved.id == personal.id
    assert resolved.subject_kind == "user"


@pytest.mark.asyncio
async def test_org_member_budget_gate_checks_org_credit_not_personal(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """Draining the PERSONAL subject's credit must not block an org member
    whose org subject still has credit — and vice versa."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    personal = await ensure_user_enrollment(db_session, user_id)
    await ensure_org_enrollment(db_session, org_id, user_id)

    # Drain the PERSONAL subject only.
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=personal.billing_subject_id,
        source=LLM_CREDIT_SOURCE_ADMIN,
        amount_usd=Decimal("1"),
    )
    await store.insert_usage_event_once(
        db_session,
        litellm_request_id=f"req-{uuid.uuid4().hex[:12]}",
        occurred_at=datetime(2026, 7, 1, 12, 0, tzinfo=UTC),
        billing_subject_id=personal.billing_subject_id,
        cost_usd=5.0,
    )
    personal_balance = await store.get_remaining_credit_usd(
        db_session, personal.billing_subject_id
    )
    assert personal_balance.remaining_usd < Decimal("0")

    # The org member's own gateway availability is unaffected: the org
    # subject (default org budget, no grant of its own) is what's checked.
    assert await is_gateway_budget_available(db_session, user_id) is True


@pytest.mark.asyncio
async def test_org_member_state_render_uses_org_enrollment_key(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """The rendered gateway source's key comes from the org enrollment's
    per-harness child key, not the member's personal one."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(
        settings,
        "agent_gateway_litellm_public_base_url",
        "https://llm.proliferate.ai",
    )
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    await ensure_user_enrollment(db_session, user_id)
    org_enrollment = await ensure_org_enrollment(db_session, org_id, user_id)
    org_claude_key = await store.get_active_enrollment_key(
        db_session, enrollment_id=org_enrollment.id, harness_kind="claude"
    )
    assert org_claude_key is not None
    org_key_value = await store.get_enrollment_key_virtual_key_decrypted(
        db_session, enrollment_key_id=org_claude_key.id
    )
    assert org_key_value is not None

    await put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="cloud",
        sources=[DesiredAuthSource(source_kind="gateway")],
    )

    state, _ = await build_agent_auth_state(db_session, user_id, surface="cloud")
    sources = [s for h in state["harnesses"] for s in h["sources"]]
    gateway_sources = [s for s in sources if s["kind"] == "gateway"]
    assert len(gateway_sources) == 1
    assert gateway_sources[0]["key"] == org_key_value
