"""Gateway payer resolution + fail-closed funding law (model-gateway.md).

v1 payer law: the subject that pays for a user's gateway sessions is their
DEFAULT org — the org their identity was placed into at signup, i.e. the
earliest active membership — always. The interim funding-follows-attribution
guard (org governs only when funded, else fall back to the personal
enrollment), the name-ordered org choice, and the personal-enrollment
fallback itself are all deleted; funding never re-routes payment to a
different subject, and the resolver is org-only.

Unfunded fails closed instead: a subject with no active credit grant and no
explicitly configured positive default budget gets no gateway — the budget
gate refuses, the state renderer withholds key material, and the mirrored
LiteLLM team budget sits at the exhausted floor (see the enrollment tests).

Proof ledger: D8 (default-org resolution, guard + name-ordered choice gone)
and the gate/renderer halves of D3 (unfunded fails closed) live here. Legacy
personal rows appearing below are fabricated at the model level: they are the
pre-migration residue the D-3 migration retires, kept here only to prove the
resolver never returns them.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import LLM_CREDIT_SOURCE_ADMIN
from proliferate.db.models.auth import User
from proliferate.db.models.agent_gateway import AgentGatewayEnrollment
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.agent_gateway import DesiredAuthSource
from proliferate.db.store.agent_gateway.selections import put_auth_selections
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.server.agent_auth import service as gateway_service
from proliferate.server.agent_auth.budget import (
    get_gateway_enrollment_for_user,
    is_gateway_budget_available,
)
from proliferate.server.agent_auth.enrollment import (
    ensure_org_enrollment,
    ensure_signup_enrollment,
)
from proliferate.server.agent_auth.state_render import (
    build_agent_auth_state,
)
from proliferate.lib.infra.time.wall_clock import utcnow
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
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    name: str | None = None,
    membership_created_at: datetime | None = None,
) -> uuid.UUID:
    organization = Organization(name=name or f"Gateway Org {uuid.uuid4().hex[:6]}")
    db_session.add(organization)
    await db_session.flush()
    membership = OrganizationMembership(
        organization_id=organization.id,
        user_id=user_id,
        role="member",
        status="active",
    )
    if membership_created_at is not None:
        membership.created_at = membership_created_at
        membership.joined_at = membership_created_at
    db_session.add(membership)
    await db_session.flush()
    return organization.id


async def _legacy_personal_enrollment(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    with_claude_key: bool = False,
) -> AgentGatewayEnrollment:
    """Fabricate pre-D-2 personal residue directly at the model level.

    No store or service path can create this shape anymore (org-only account
    model); tests build it raw to prove the resolver and renderer ignore it
    until the D-3 migration retires it.
    """
    subject = await ensure_personal_billing_subject(db_session, user_id)
    now = utcnow()
    row = AgentGatewayEnrollment(
        subject_kind="user",
        user_id=user_id,
        organization_id=None,
        billing_subject_id=subject.id,
        litellm_team_id=f"team-user-{user_id}",
        litellm_user_id=f"user-{user_id}",
        sync_status="synced",
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    await db_session.flush()
    if with_claude_key:
        await store.upsert_enrollment_key(
            db_session,
            enrollment_id=row.id,
            harness_kind="claude",
            virtual_key_id=f"token-personal-{uuid.uuid4().hex[:6]}",
            virtual_key="sk-litellm-personal",
            sync_fingerprint="legacy-fp",
        )
    return row


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
async def test_default_org_governs_unconditionally_even_when_unfunded(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """D8: no funding guard — the org enrollment governs with zero grants.

    The deleted guard resolved the PERSONAL enrollment here (org subject
    unfunded). Funding never re-routes payment; it is enforced by the budget
    gate instead — even while an unretired, funded personal residue row still
    exists.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "0")
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    personal = await _legacy_personal_enrollment(db_session, user_id=user_id)
    org_enrollment = await ensure_org_enrollment(db_session, org_id, user_id)
    assert personal.id != org_enrollment.id
    # A personal grant must not pull resolution back to the personal subject.
    await _grant(db_session, billing_subject_id=personal.billing_subject_id, amount="5")

    resolved = await get_gateway_enrollment_for_user(db_session, user_id)
    assert resolved is not None
    assert resolved.id == org_enrollment.id
    assert resolved.subject_kind == "organization"


@pytest.mark.asyncio
async def test_unfunded_org_fails_closed_at_the_gate(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """D3 (gate): no org grant + no explicit org budget → launches refused.

    Replaces the deleted "no grant means unlimited" behavior: the gate no
    longer answers True for a grant-less subject, and a funded PERSONAL
    subject cannot stand in for the unfunded default org (the guard that did
    that fallback is gone).
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "0")
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    personal_subject = await ensure_personal_billing_subject(db_session, user_id)
    await ensure_org_enrollment(db_session, org_id, user_id)
    await _grant(db_session, billing_subject_id=personal_subject.id, amount="5")

    assert await is_gateway_budget_available(db_session, user_id) is False


@pytest.mark.asyncio
async def test_unfunded_org_state_render_withholds_gateway_key(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """D3 (renderer): an unfunded org member's render drops the gateway source.

    The runtime then fails closed at launch (empty ``sources``); granting the
    org credit is what turns the key back on, proving funding was the only
    thing withheld.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "0")
    monkeypatch.setattr(
        settings,
        "agent_gateway_litellm_public_base_url",
        "https://llm.proliferate.ai",
    )
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)
    org_enrollment = await ensure_org_enrollment(db_session, org_id, user_id)

    await put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="cloud",
        sources=[DesiredAuthSource(source_kind="gateway")],
    )

    state, _ = await build_agent_auth_state(db_session, user_id, surface="cloud")
    sources = [s for h in state["harnesses"] for s in h["sources"]]
    assert not any(s["kind"] == "gateway" for s in sources)

    await _grant(db_session, billing_subject_id=org_enrollment.billing_subject_id, amount="50")
    state, _ = await build_agent_auth_state(db_session, user_id, surface="cloud")
    sources = [s for h in state["harnesses"] for s in h["sources"]]
    assert any(s["kind"] == "gateway" and s.get("key") for s in sources)


@pytest.mark.asyncio
async def test_explicit_org_budget_keeps_a_grantless_org_open(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """A deployment-configured positive org budget is a real funding source:
    the LiteLLM team budget is the guardrail, so the ledger gate stays open."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "250")
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    org_enrollment = await ensure_org_enrollment(db_session, org_id, user_id)

    resolved = await get_gateway_enrollment_for_user(db_session, user_id)
    assert resolved is not None
    assert resolved.id == org_enrollment.id
    assert await is_gateway_budget_available(db_session, user_id) is True


@pytest.mark.asyncio
async def test_resolver_is_org_only_even_with_unretired_personal_residue(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """The personal fallback is GONE: residue resolves to nothing, never itself.

    An org-less user holding a pre-migration personal row (the shape the D-3
    migration retires; here fabricated raw and not yet converted because the
    user has no default org) gets ``None`` from the resolver — the fallback
    that used to hand this row out is deleted, and only the migration giving
    the user an org enrollment can restore gateway access.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    user_id = await _create_user(db_session)

    await _legacy_personal_enrollment(db_session, user_id=user_id)

    assert await get_gateway_enrollment_for_user(db_session, user_id) is None
    with pytest.raises(gateway_service.CloudApiError):
        await gateway_service.get_enrollment(db_session, user_id=user_id)


@pytest.mark.asyncio
async def test_new_signup_never_creates_or_takes_a_personal_shape(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """The org-only signup shape creates no ``subject_kind='user'`` row at all,
    and the default org's enrollment governs whether funded or not (an
    unfunded org fails closed at the budget gate; it never re-routes to a
    personal subject)."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "0")
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    enrollment = await ensure_signup_enrollment(db_session, user_id)

    assert enrollment is not None
    assert enrollment.subject_kind == "organization"
    assert enrollment.organization_id == org_id
    # No personal row exists anywhere.
    personal_rows = (
        (
            await db_session.execute(
                select(AgentGatewayEnrollment).where(
                    AgentGatewayEnrollment.subject_kind == "user",
                    AgentGatewayEnrollment.user_id == user_id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert personal_rows == []
    resolved = await get_gateway_enrollment_for_user(db_session, user_id)
    assert resolved is not None
    assert resolved.id == enrollment.id

    # Even with the org unfunded (gate refuses), resolution stays on the org:
    # fail-closed never re-routes payment to another subject.
    assert await is_gateway_budget_available(db_session, user_id) is False
    still_resolved = await get_gateway_enrollment_for_user(db_session, user_id)
    assert still_resolved is not None
    assert still_resolved.id == enrollment.id
    assert still_resolved.subject_kind == "organization"


@pytest.mark.asyncio
async def test_org_gate_follows_only_the_org_ledger(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """The default org's ledger is the only one the gate reads: draining the
    personal subject changes nothing, draining the org subject blocks."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "0")
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    personal_subject = await ensure_personal_billing_subject(db_session, user_id)
    org_enrollment = await ensure_org_enrollment(db_session, org_id, user_id)
    await _grant(db_session, billing_subject_id=org_enrollment.billing_subject_id, amount="50")
    await _grant(db_session, billing_subject_id=personal_subject.id, amount="1")

    await _drain(db_session, billing_subject_id=personal_subject.id)
    assert await is_gateway_budget_available(db_session, user_id) is True

    await _drain(db_session, billing_subject_id=org_enrollment.billing_subject_id)
    assert await is_gateway_budget_available(db_session, user_id) is False


@pytest.mark.asyncio
async def test_org_member_state_render_uses_org_enrollment_key(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """The rendered gateway source's key comes from the default org
    enrollment's per-harness child key — never from unretired personal
    residue holding a key of its own."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(
        settings,
        "agent_gateway_litellm_public_base_url",
        "https://llm.proliferate.ai",
    )
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    await _legacy_personal_enrollment(db_session, user_id=user_id, with_claude_key=True)
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
async def test_capabilities_reports_credits_exhausted_when_renderer_withholds(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """AA-3: the capabilities flag and the withheld key can never disagree.

    ``get_capabilities`` computes ``credits_exhausted`` from the same
    predicate the renderer withholds keys on, so the settings surface names
    "out of credits" exactly when a gateway launch would fail closed with
    the runtime's generic ``AGENT_ROUTE_SELECTION_MISSING``. Granting credit
    must flip both back together.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "0")
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)
    org_enrollment = await ensure_org_enrollment(db_session, org_id, user_id)

    _, _, _, credits_exhausted = await gateway_service.get_capabilities(
        db_session, user_id=user_id
    )
    assert credits_exhausted is True
    assert await is_gateway_budget_available(db_session, user_id) is False

    await _grant(db_session, billing_subject_id=org_enrollment.billing_subject_id, amount="50")
    _, _, _, credits_exhausted = await gateway_service.get_capabilities(
        db_session, user_id=user_id
    )
    assert credits_exhausted is False
    assert await is_gateway_budget_available(db_session, user_id) is True


@pytest.mark.asyncio
async def test_every_gateway_key_reader_resolves_the_same_enrollment(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """Divergence guard: gate, renderer, and capabilities must agree.

    The call sites that read gateway key material or report its readiness must
    all resolve the same enrollment; otherwise the gate can authorize one
    paying subject while a key from another is handed out (or the UI reports a
    readiness that does not describe the key in use).
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(
        settings,
        "agent_gateway_litellm_public_base_url",
        "https://llm.proliferate.ai",
    )
    user_id = await _create_user(db_session)
    org_id = await _create_org_with_active_member(db_session, user_id=user_id)

    personal = await _legacy_personal_enrollment(db_session, user_id=user_id, with_claude_key=True)
    org_enrollment = await ensure_org_enrollment(db_session, org_id, user_id)
    await _grant(db_session, billing_subject_id=org_enrollment.billing_subject_id, amount="50")

    governing = await get_gateway_enrollment_for_user(db_session, user_id)
    assert governing is not None
    assert governing.id == org_enrollment.id

    # Every remaining reader of gateway key material resolves off this same
    # enrollment (the state renderer and the budget gate). Assert on the key
    # they resolve for a harness — distinct from the residue row's key.
    org_key = await store.get_active_enrollment_key(
        db_session, enrollment_id=governing.id, harness_kind="claude"
    )
    personal_key = await store.get_active_enrollment_key(
        db_session, enrollment_id=personal.id, harness_kind="claude"
    )
    assert org_key is not None and personal_key is not None
    assert org_key.virtual_key_id != personal_key.virtual_key_id

    # get_capabilities / get_enrollment report the governing enrollment.
    _, _, status, _ = await gateway_service.get_capabilities(db_session, user_id=user_id)
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
async def test_multi_org_membership_resolves_the_default_org_not_the_name_order(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """D8: the payer is the EARLIEST membership (the signup default org).

    The deleted name-ordered choice (`get_current_membership_for_user`) would
    pick "Alpha ..." here; the default-org resolution picks "Zulu ..." because
    it was joined first. Funding the later org must not move the payer either
    (that would be the deleted guard's funded-org preference).
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    user_id = await _create_user(db_session)
    suffix = uuid.uuid4().hex[:6]
    base = datetime(2026, 7, 1, 9, 0, tzinfo=UTC)
    zulu_id = await _create_org_with_active_member(
        db_session,
        user_id=user_id,
        name=f"Zulu Org {suffix}",
        membership_created_at=base,
    )
    alpha_id = await _create_org_with_active_member(
        db_session,
        user_id=user_id,
        name=f"Alpha Org {suffix}",
        membership_created_at=base + timedelta(days=1),
    )

    zulu_enrollment = await ensure_org_enrollment(db_session, zulu_id, user_id)
    alpha_enrollment = await ensure_org_enrollment(db_session, alpha_id, user_id)
    # Only the later, name-first org is funded — and it still must not govern.
    await _grant(db_session, billing_subject_id=alpha_enrollment.billing_subject_id, amount="50")

    resolved = await get_gateway_enrollment_for_user(db_session, user_id)
    assert resolved is not None
    assert resolved.id == zulu_enrollment.id
    assert resolved.id != alpha_enrollment.id
