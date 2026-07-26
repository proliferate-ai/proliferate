"""Org-member gateway resolution (model-gateway.md org-member gap, closed by B3).

Before this fix, an org member's gateway sessions always resolved their
PERSONAL enrollment (state renderer and budget gate both called
``get_enrollment_for_user`` unconditionally), so org members' gateway spend
landed on their personal subject rather than the org's.

The fix routes an org member to their ORG enrollment, but only when the org
billing subject is actually FUNDED — the funding-follows-attribution guard
(interim; founder end-state ruling pending). On hosted every user gets a
default personal org, so unconditional org routing would send every user to a
subject with no credit grant: ``is_gateway_budget_available`` returns ``True``
unconditionally for a grant-less subject and the org team's default budget of
"0" means *uncapped* in LiteLLM, so both walls open and the personal free
credit is never consulted. An unfunded org therefore falls back to the personal
enrollment (pre-B3 behavior); a funded org governs.
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
from proliferate.server.cloud.agent_gateway import service as gateway_service
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
    db_session: AsyncSession, *, user_id: uuid.UUID, name: str | None = None
) -> uuid.UUID:
    organization = Organization(name=name or f"Gateway Org {uuid.uuid4().hex[:6]}")
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


async def _grant(db_session: AsyncSession, *, billing_subject_id: uuid.UUID, amount: str) -> None:
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=billing_subject_id,
        source=LLM_CREDIT_SOURCE_ADMIN,
        amount_usd=Decimal(amount),
    )


async def _drain(db_session: AsyncSession, *, billing_subject_id: uuid.UUID) -> None:
    await store.insert_usage_event_once(
        db_session,
        litellm_request_id=f"req-{uuid.uuid4().hex[:12]}",
        occurred_at=datetime(2026, 7, 1, 12, 0, tzinfo=UTC),
        billing_subject_id=billing_subject_id,
        cost_usd=1_000.0,
    )


@pytest.mark.asyncio
async def test_funded_org_governs_the_members_gateway(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """An org with a real credit grant is the subject that governs its members."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    personal = await ensure_user_enrollment(db_session, user_id)
    org_enrollment = await ensure_org_enrollment(db_session, org_id, user_id)
    assert personal.id != org_enrollment.id
    await _grant(db_session, billing_subject_id=org_enrollment.billing_subject_id, amount="50")

    resolved = await get_gateway_enrollment_for_user(db_session, user_id)
    assert resolved is not None
    assert resolved.id == org_enrollment.id
    assert resolved.subject_kind == "organization"


@pytest.mark.asyncio
async def test_unfunded_org_falls_back_to_the_personal_enrollment(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """The guard: no org grant and no explicit org budget → personal governs.

    Routing to the unfunded org subject would make the gate's ``granted <= 0``
    branch return True unconditionally while LiteLLM reads the org team's "0"
    budget as uncapped — unlimited spend with the personal grant never
    consulted.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "0")
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    personal = await ensure_user_enrollment(db_session, user_id)
    await ensure_org_enrollment(db_session, org_id, user_id)

    resolved = await get_gateway_enrollment_for_user(db_session, user_id)
    assert resolved is not None
    assert resolved.id == personal.id
    assert resolved.subject_kind == "user"


@pytest.mark.asyncio
async def test_explicit_org_budget_also_counts_as_funded(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """A deployment that configures a real org team cap has a funding source."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "250")
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    await ensure_user_enrollment(db_session, user_id)
    org_enrollment = await ensure_org_enrollment(db_session, org_id, user_id)

    resolved = await get_gateway_enrollment_for_user(db_session, user_id)
    assert resolved is not None
    assert resolved.id == org_enrollment.id


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
async def test_unfunded_org_member_is_blocked_by_a_drained_personal_grant(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """The money assertion: personal credit still caps an unfunded-org member.

    This is what the pre-fix version of this suite asserted backwards — it
    treated "drained personal grant does not block the member" as the desired
    behavior, which is exactly the unlimited-spend hole (the member's only
    funding source was drained, yet nothing stopped them).
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "0")
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    personal = await ensure_user_enrollment(db_session, user_id)
    await ensure_org_enrollment(db_session, org_id, user_id)
    await _grant(db_session, billing_subject_id=personal.billing_subject_id, amount="1")

    assert await is_gateway_budget_available(db_session, user_id) is True

    await _drain(db_session, billing_subject_id=personal.billing_subject_id)

    assert await is_gateway_budget_available(db_session, user_id) is False


@pytest.mark.asyncio
async def test_funded_org_budgets_are_independent_of_personal_credit(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """Once the org funds the member, the two ledgers move independently."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "0")
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    personal = await ensure_user_enrollment(db_session, user_id)
    org_enrollment = await ensure_org_enrollment(db_session, org_id, user_id)
    await _grant(db_session, billing_subject_id=org_enrollment.billing_subject_id, amount="50")
    await _grant(db_session, billing_subject_id=personal.billing_subject_id, amount="1")

    # Draining the PERSONAL subject does not block a member the org funds.
    await _drain(db_session, billing_subject_id=personal.billing_subject_id)
    assert await is_gateway_budget_available(db_session, user_id) is True

    # Draining the ORG subject does block them — that is the governing ledger.
    await _drain(db_session, billing_subject_id=org_enrollment.billing_subject_id)
    assert await is_gateway_budget_available(db_session, user_id) is False


@pytest.mark.asyncio
async def test_org_member_state_render_uses_org_enrollment_key(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """The rendered gateway source's key comes from the funded org enrollment's
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
    await _grant(db_session, billing_subject_id=org_enrollment.billing_subject_id, amount="50")
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


@pytest.mark.asyncio
async def test_every_gateway_key_reader_resolves_the_same_enrollment(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """Divergence guard: gate, renderer, probe, and capabilities must agree.

    Four call sites read gateway key material or report its readiness. If any
    one of them resolves a different enrollment than the others, the gate can
    authorize one paying subject while a key from another is handed out (or the
    UI reports a readiness that does not describe the key in use).
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(
        settings,
        "agent_gateway_litellm_public_base_url",
        "https://llm.proliferate.ai",
    )
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    personal = await ensure_user_enrollment(db_session, user_id)
    org_enrollment = await ensure_org_enrollment(db_session, org_id, user_id)
    await _grant(db_session, billing_subject_id=org_enrollment.billing_subject_id, amount="50")

    governing = await get_gateway_enrollment_for_user(db_session, user_id)
    assert governing is not None
    assert governing.id == org_enrollment.id

    # The probe path (catalog._probe_gateway_models) reads its key off the same
    # enrollment; assert on the key it would resolve for a harness.
    org_key = await store.get_active_enrollment_key(
        db_session, enrollment_id=governing.id, harness_kind="claude"
    )
    personal_key = await store.get_active_enrollment_key(
        db_session, enrollment_id=personal.id, harness_kind="claude"
    )
    assert org_key is not None and personal_key is not None
    assert org_key.virtual_key_id != personal_key.virtual_key_id

    # get_capabilities / get_enrollment report the governing enrollment.
    _, _, status = await gateway_service.get_capabilities(db_session, user_id=user_id)
    assert status == governing.sync_status
    reported = await gateway_service.get_enrollment(db_session, user_id=user_id)
    assert reported.id == governing.id

    # The renderer hands out the governing enrollment's key.
    await put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="cloud",
        sources=[DesiredAuthSource(source_kind="gateway")],
    )
    state, _ = await build_agent_auth_state(db_session, user_id, surface="cloud")
    rendered = [
        source
        for harness in state["harnesses"]
        for source in harness["sources"]
        if source["kind"] == "gateway"
    ]
    expected = await store.get_enrollment_key_virtual_key_decrypted(
        db_session, enrollment_key_id=org_key.id
    )
    assert [source["key"] for source in rendered] == [expected]


@pytest.mark.asyncio
async def test_multi_org_membership_picks_the_first_org_by_name(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """Deterministic payer across several funded memberships.

    ``get_current_membership_for_user`` orders active memberships by
    organization NAME and takes the first, so the chosen payer is stable for a
    fixed set of names — but renaming an org can move it. This pins the current
    behavior (inherited from the compute attribution path) so a change is a
    deliberate one.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    user_id = await _create_user(db_session)
    suffix = uuid.uuid4().hex[:6]
    alpha_id = await _create_org_with_active_member(
        db_session, user_id=user_id, name=f"Alpha Org {suffix}"
    )
    zulu_id = await _create_org_with_active_member(
        db_session, user_id=user_id, name=f"Zulu Org {suffix}"
    )

    await ensure_user_enrollment(db_session, user_id)
    alpha_enrollment = await ensure_org_enrollment(db_session, alpha_id, user_id)
    zulu_enrollment = await ensure_org_enrollment(db_session, zulu_id, user_id)
    # Both orgs funded, so the guard does not decide between them.
    await _grant(db_session, billing_subject_id=alpha_enrollment.billing_subject_id, amount="50")
    await _grant(db_session, billing_subject_id=zulu_enrollment.billing_subject_id, amount="50")

    resolved = await get_gateway_enrollment_for_user(db_session, user_id)
    assert resolved is not None
    assert resolved.id == alpha_enrollment.id
    assert resolved.id != zulu_enrollment.id
