"""Enrollment service tests with a stubbed LiteLLM admin client.

Org-only account model (model-gateway.md §Account model): a new signup is
enrolled into their default org — one LiteLLM team per org (``org-<uuid>``),
one LiteLLM user per (org, member) (``org-<org>-user-<uuid>``), one
access-group-scoped key per (member, gateway-capable harness), and the free
signup grant on the default org's billing subject. Proof ledger: D1 lives
here (see also the free-credits tests for D2 and the org-member tests for
D3/D8).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS,
    LLM_CREDIT_SOURCE_ADMIN,
)
from proliferate.db.models.auth import AuthIdentity, User
from proliferate.db.models.agent_gateway import (
    AgentAuthSelection,
    AgentGatewayEnrollment,
    AgentGatewayEnrollmentKey,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.agent_gateway import DesiredAuthSource
from proliferate.db.store.billing_subjects import (
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.integrations.litellm import LiteLLMIntegrationError, LiteLLMVirtualKey
from proliferate.server.agent_auth import enrollment as enrollment_service
from proliferate.server.agent_auth.budget import get_gateway_enrollment_for_user
from proliferate.server.agent_auth.enrollment import (
    _parse_budget,
    _remaining_credit_budget_raw,
    backfill_enrollments,
    ensure_org_enrollment,
    ensure_signup_enrollment,
)
from proliferate.server.cloud.materialization.materialize.agent_auth import (
    build_agent_auth_state,
)
from proliferate.lib.infra.time.wall_clock import utcnow


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"enroll-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


async def _no_personal_enrollment(db_session: AsyncSession, user_id: uuid.UUID) -> bool:
    """True when no active pre-migration personal row exists for the user.

    The store has no personal lookup anymore (the resolver is org-only), so
    tests assert the row's absence against the table directly.
    """
    from sqlalchemy import select

    row = (
        await db_session.execute(
            select(AgentGatewayEnrollment).where(
                AgentGatewayEnrollment.subject_kind == "user",
                AgentGatewayEnrollment.user_id == user_id,
                AgentGatewayEnrollment.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    return row is None


async def _link_github_identity(db_session: AsyncSession, *, user_id: uuid.UUID) -> None:
    subject = f"gh-{uuid.uuid4().hex[:12]}"
    db_session.add(
        AuthIdentity(
            user_id=user_id,
            provider="github",
            provider_subject=subject,
            email=f"{subject}@example.com",
            email_verified=True,
        )
    )
    await db_session.flush()


async def _place_in_org(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    name: str | None = None,
) -> uuid.UUID:
    """Create an org with an active membership for the user (signup placement)."""
    organization = Organization(name=name or f"Enroll Org {uuid.uuid4().hex[:6]}")
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


class StubLiteLLM:
    def __init__(self) -> None:
        self.teams: dict[str, str] = {}
        self.users: set[str] = set()
        self.team_metadata: list[dict[str, Any] | None] = []
        self.user_metadata: list[dict[str, Any] | None] = []
        # ensure_team's max_budget per call, in call order — the team is the
        # only budget layer (keys never carry one), so mirrored-budget
        # assertions read this.
        self.ensure_team_budgets: list[float | None] = []
        self.minted: list[dict[str, Any]] = []
        # Live keys keyed by alias -> token_id, mirroring LiteLLM's globally
        # unique key_alias enforcement so idempotency can be exercised.
        self.live_aliases: dict[str, str] = {}
        self.deleted_aliases: list[str] = []
        self.fail_mint = False

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(enrollment_service.litellm, "ensure_team", self.ensure_team)
        monkeypatch.setattr(enrollment_service.litellm, "ensure_user", self.ensure_user)
        monkeypatch.setattr(
            enrollment_service.litellm,
            "mint_virtual_key",
            self.mint_virtual_key,
        )
        monkeypatch.setattr(
            enrollment_service.litellm,
            "delete_virtual_keys_by_alias",
            self.delete_virtual_keys_by_alias,
        )

    async def ensure_team(
        self,
        *,
        alias: str,
        max_budget: float | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        self.team_metadata.append(metadata)
        self.ensure_team_budgets.append(max_budget)
        team_id = self.teams.setdefault(alias, f"team-{alias}")
        return team_id

    async def ensure_user(self, *, user_id: str, metadata: dict[str, Any] | None = None) -> str:
        self.user_metadata.append(metadata)
        self.users.add(user_id)
        return user_id

    async def mint_virtual_key(
        self,
        *,
        user_id: str,
        team_id: str | None = None,
        alias: str | None = None,
        max_budget: float | None = None,
        metadata: dict[str, Any] | None = None,
        models: list[str] | None = None,
    ) -> LiteLLMVirtualKey:
        if self.fail_mint:
            raise LiteLLMIntegrationError("litellm_request_failed", "mint exploded")
        if alias is not None and alias in self.live_aliases:
            raise LiteLLMIntegrationError(
                "litellm_request_failed",
                f"Unable to create key: key_alias {alias} already exists",
                status_code=400,
            )
        record = {
            "user_id": user_id,
            "team_id": team_id,
            "alias": alias,
            "max_budget": max_budget,
            "metadata": metadata or {},
            "models": models,
        }
        self.minted.append(record)
        token_id = f"token-{len(self.minted)}"
        if alias is not None:
            self.live_aliases[alias] = token_id
        return LiteLLMVirtualKey(
            key=f"sk-litellm-{len(self.minted)}",
            token_id=token_id,
            key_alias=alias,
            user_id=user_id,
            team_id=team_id,
            max_budget=max_budget,
        )

    async def delete_virtual_keys_by_alias(self, *, alias: str) -> int:
        if alias not in self.live_aliases:
            return 0
        del self.live_aliases[alias]
        self.deleted_aliases.append(alias)
        return 1


@pytest.fixture
def stub_litellm(monkeypatch: pytest.MonkeyPatch) -> StubLiteLLM:
    stub = StubLiteLLM()
    stub.install(monkeypatch)
    return stub


@pytest.mark.asyncio
async def test_signup_enrollment_stays_pending_when_gateway_disabled(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    user_id = await _create_user(db_session)
    org_id = await _place_in_org(db_session, user_id=user_id)

    enrollment = await ensure_signup_enrollment(db_session, user_id)

    assert enrollment is not None
    assert enrollment.sync_status == "pending"
    assert enrollment.subject_kind == "organization"
    assert enrollment.organization_id == org_id
    assert stub_litellm.minted == []


@pytest.mark.asyncio
async def test_d1_signup_produces_the_org_only_shape(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """D1: signup → org team, per-(org, member) LiteLLM user, per-harness keys,
    free grant on the default org's billing subject — and NO personal shape.

    The whole account shape has exactly one form (model-gateway.md §Account
    model): team ``org-<id>``, LiteLLM user ``org-<org>-user-<id>`` (never the
    old shared global ``user-<id>``), one key per gateway-capable harness
    (cursor absent), and the signup grant landing on the org subject so the
    mirrored team budget reflects it at first sync.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    org_id = await _place_in_org(db_session, user_id=user_id)

    enrollment = await ensure_signup_enrollment(db_session, user_id)

    assert enrollment is not None
    assert enrollment.sync_status == "synced"
    assert enrollment.subject_kind == "organization"
    assert enrollment.organization_id == org_id
    assert enrollment.user_id == user_id
    # One team per org, one LiteLLM user per (org, member).
    assert enrollment.litellm_team_id == f"team-org-{org_id}"
    assert enrollment.litellm_user_id == f"org-{org_id}-user-{user_id}"
    assert f"org-{org_id}-user-{user_id}" in stub_litellm.users
    # The old shared global identity is never minted for a new signup.
    assert f"user-{user_id}" not in stub_litellm.users
    # Post-B2: no key material on the parent row; one child key per
    # gateway-capable harness, cursor absent by construction.
    assert enrollment.virtual_key_id is None
    enrollment_keys = await store.list_active_enrollment_keys(
        db_session, enrollment_id=enrollment.id
    )
    minted_kinds = {key.harness_kind for key in enrollment_keys}
    assert minted_kinds == set(AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS)
    assert "cursor" not in minted_kinds
    for record in stub_litellm.minted:
        assert record["user_id"] == f"org-{org_id}-user-{user_id}"
        assert record["max_budget"] is None
        assert record["models"] == [record["metadata"]["proliferate_harness_kind"]]

    # The free grant landed on the DEFAULT ORG's billing subject and the
    # team budget mirrors it; the personal subject holds nothing.
    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    assert enrollment.billing_subject_id == org_subject.id
    balance = await store.get_remaining_credit_usd(db_session, org_subject.id)
    assert balance.granted_usd == Decimal("5")
    assert stub_litellm.ensure_team_budgets == [5.0]
    personal_subject = await ensure_personal_billing_subject(db_session, user_id)
    personal_balance = await store.get_remaining_credit_usd(db_session, personal_subject.id)
    assert personal_balance.granted_usd == Decimal("0")

    # No personal enrollment row exists anywhere for this user — the whole
    # account shape has exactly one form.
    assert await _no_personal_enrollment(db_session, user_id)
    resolved = await get_gateway_enrollment_for_user(db_session, user_id)
    assert resolved is not None
    assert resolved.id == enrollment.id

    # Idempotent: a second pass re-mints nothing and grants nothing more.
    again = await ensure_signup_enrollment(db_session, user_id)
    assert again is not None
    assert again.id == enrollment.id
    assert len(stub_litellm.minted) == len(AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS)
    balance = await store.get_remaining_credit_usd(db_session, org_subject.id)
    assert balance.granted_usd == Decimal("5")


@pytest.mark.asyncio
async def test_signup_enrollment_without_default_org_creates_nothing(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """An identity not yet placed into any org gets no enrollment of any kind.

    In particular no personal-subject row: the org-only shape has no other
    form to fall back to, and the backfill's membership discovery picks the
    user up once their placement lands.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    user_id = await _create_user(db_session)

    enrollment = await ensure_signup_enrollment(db_session, user_id)

    assert enrollment is None
    assert await _no_personal_enrollment(db_session, user_id)
    assert stub_litellm.minted == []
    assert stub_litellm.users == set()


@pytest.mark.asyncio
async def test_qualification_enrollment_stamps_exact_run_ownership(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_qualification_run_id", "qlc-ci-123-1")
    monkeypatch.setattr(settings, "agent_gateway_qualification_shard_id", "1")
    user_id = await _create_user(db_session)
    await _place_in_org(db_session, user_id=user_id)

    await ensure_signup_enrollment(db_session, user_id)

    expected = {
        "proliferate_qualification_run_id": "qlc-ci-123-1",
        "proliferate_qualification_shard_id": "1",
    }
    assert stub_litellm.team_metadata == [expected]
    assert stub_litellm.user_metadata == [expected]
    assert all(stub_litellm.minted[0]["metadata"][key] == value for key, value in expected.items())


@pytest.mark.asyncio
async def test_enrollment_sync_completion_pokes_both_delivery_surfaces(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """Proof C5 (agent-auth.md): a state pulled before enrollment sync lacks
    the key; sync completion re-renders both surfaces with no unrelated
    mutation needed.

    Cloud poke: reaching ``synced`` schedules agent-auth materialization into
    the user's sandbox. Local poke: the local surface's revision seam is
    bumped, so the desktop's next pull renders WITH the key at a strictly
    newer revision than the keyless document it pulled mid-sync — no
    selection edit, vault mutation, or app restart in between.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    monkeypatch.setattr(
        settings,
        "agent_gateway_litellm_public_base_url",
        "https://llm.proliferate.ai",
    )
    # Org-only account model: fund the default org via the signup grant
    # (GitHub-identity-deduped) so the renderer's fail-closed budget gate
    # does not withhold the key this test asserts on.
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    await _place_in_org(db_session, user_id=user_id)

    # Gateway selections on BOTH surfaces, made BEFORE enrollment sync lands
    # (the desktop's "pulled too early" race). Backdate the rows so the
    # revision comparison below cannot collapse into the same millisecond.
    for surface in ("local", "cloud"):
        await store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface=surface,
            sources=[DesiredAuthSource(source_kind="gateway")],
        )
    await db_session.execute(
        update(AgentAuthSelection)
        .where(AgentAuthSelection.user_id == user_id)
        .values(updated_at=utcnow() - timedelta(seconds=5))
    )

    pre_state, _ = await build_agent_auth_state(db_session, user_id, surface="local")
    assert pre_state["harnesses"] == [{"harness_kind": "claude", "sources": []}]
    pre_revision = pre_state["revision"]
    assert isinstance(pre_revision, int) and pre_revision > 0

    scheduled: list[tuple[uuid.UUID, bool]] = []

    async def record_schedule(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        ensure_sandbox: bool = False,
    ) -> None:
        scheduled.append((user_id, ensure_sandbox))

    monkeypatch.setattr(
        enrollment_service.materialization_service,
        "schedule_materialize_agent_auth",
        record_schedule,
    )

    enrollment = await ensure_signup_enrollment(db_session, user_id)
    assert enrollment is not None
    assert enrollment.sync_status == "synced"

    # Cloud surface: one plain (non-ensure) materialization pass scheduled —
    # a user who never provisioned a sandbox still falls to bootstrap.
    assert scheduled == [(user_id, False)]

    # Local surface: the SAME pull the desktop loops on now renders the key,
    # at a strictly newer revision, with no unrelated mutation.
    post_state, _ = await build_agent_auth_state(db_session, user_id, surface="local")
    [harness] = post_state["harnesses"]
    [source] = harness["sources"]
    assert source["kind"] == "gateway"
    assert source["base_url"] == "https://llm.proliferate.ai"
    assert source["key"].startswith("sk-litellm-")
    post_revision = post_state["revision"]
    assert isinstance(post_revision, int)
    assert post_revision > pre_revision


@pytest.mark.asyncio
async def test_already_synced_enrollment_does_not_re_poke(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """The pokes fire on the pending→synced TRANSITION, not on every ensure
    pass — an already-synced enrollment (every login) must not churn the
    local revision or schedule redundant sandbox writes."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    user_id = await _create_user(db_session)
    await _place_in_org(db_session, user_id=user_id)
    await store.put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="local",
        sources=[DesiredAuthSource(source_kind="gateway")],
    )
    first = await ensure_signup_enrollment(db_session, user_id)
    assert first is not None
    assert first.sync_status == "synced"
    await db_session.execute(
        update(AgentAuthSelection)
        .where(AgentAuthSelection.user_id == user_id)
        .values(updated_at=utcnow() - timedelta(seconds=5))
    )
    pre_state, _ = await build_agent_auth_state(db_session, user_id, surface="local")

    scheduled: list[uuid.UUID] = []

    async def record_schedule(
        db: AsyncSession,
        *,
        user_id: uuid.UUID,
        ensure_sandbox: bool = False,
    ) -> None:
        scheduled.append(user_id)

    monkeypatch.setattr(
        enrollment_service.materialization_service,
        "schedule_materialize_agent_auth",
        record_schedule,
    )

    again = await ensure_signup_enrollment(db_session, user_id)
    assert again is not None
    assert again.sync_status == "synced"
    assert scheduled == []
    post_state, _ = await build_agent_auth_state(db_session, user_id, surface="local")
    assert post_state["revision"] == pre_state["revision"]


@pytest.mark.asyncio
async def test_signup_enrollment_marks_failed_on_litellm_error(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    stub_litellm.fail_mint = True
    user_id = await _create_user(db_session)
    org_id = await _place_in_org(db_session, user_id=user_id)

    enrollment = await ensure_signup_enrollment(db_session, user_id)

    assert enrollment is not None
    assert enrollment.sync_status == "failed"
    assert enrollment.last_error_code == "litellm_request_failed"
    assert enrollment.last_error_message == "mint exploded"

    # Backfill retries the failed row once LiteLLM recovers.
    stub_litellm.fail_mint = False
    processed = await backfill_enrollments(db_session, limit=10)
    assert processed >= 1
    retried = await store.get_enrollment_for_organization(
        db_session, organization_id=org_id, user_id=user_id
    )
    assert retried is not None
    assert retried.sync_status == "synced"


@pytest.mark.asyncio
async def test_unfunded_org_enrollment_mirrors_the_exhausted_floor(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """D3 (mirror): an unfunded org's team budget is the floor, never 0/uncapped.

    Replaces the deleted "no grant means unlimited" mirroring: with no grant
    and no explicitly configured org budget, the team used to be created
    uncapped (budget ``None``). It now mirrors the tiny exhausted floor, so
    the org's keys stop working instead of becoming unlimited — and LiteLLM
    never receives a literal 0, which it reads as uncapped.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "0")
    organization = Organization(name="Enroll Org")
    db_session.add(organization)
    await db_session.flush()
    member_id = await _create_user(db_session)

    enrollment = await ensure_org_enrollment(db_session, organization.id, member_id)

    assert enrollment.sync_status == "synced"
    assert enrollment.subject_kind == "organization"
    assert enrollment.organization_id == organization.id
    assert enrollment.user_id == member_id
    assert enrollment.litellm_team_id == f"team-org-{organization.id}"
    # One LiteLLM user per (org, member) — never a global per-user identity.
    assert enrollment.litellm_user_id == f"org-{organization.id}-user-{member_id}"
    # Unfunded fails closed at the team-budget layer: a real, tiny positive cap.
    assert stub_litellm.ensure_team_budgets == [0.01]
    minted = stub_litellm.minted[0]
    # Keys never carry a budget of their own — the team is the budget layer.
    assert minted["max_budget"] is None
    assert minted["metadata"]["proliferate_organization_id"] == str(organization.id)
    assert minted["metadata"]["proliferate_user_id"] == str(member_id)


@pytest.mark.asyncio
async def test_funded_org_enrollment_mirrors_remaining_credit(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """A funded org's team budget mirrors the ledger's remaining credit."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "0")
    organization = Organization(name="Funded Enroll Org")
    db_session.add(organization)
    await db_session.flush()
    member_id = await _create_user(db_session)
    subject = await ensure_organization_billing_subject(db_session, organization.id)
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject.id,
        source=LLM_CREDIT_SOURCE_ADMIN,
        amount_usd=Decimal("50"),
    )

    enrollment = await ensure_org_enrollment(db_session, organization.id, member_id)

    assert enrollment.sync_status == "synced"
    assert stub_litellm.ensure_team_budgets == [50.0]


@pytest.mark.asyncio
async def test_org_enrollment_is_per_member(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    organization = Organization(name="Two Member Org")
    db_session.add(organization)
    await db_session.flush()
    first = await _create_user(db_session)
    second = await _create_user(db_session)

    first_enrollment = await ensure_org_enrollment(db_session, organization.id, first)
    second_enrollment = await ensure_org_enrollment(db_session, organization.id, second)

    # Distinct rows under the same shared org team, each with its own
    # per-(org, member) LiteLLM user and per-harness child keys (post-B2:
    # the parent row carries no key itself).
    assert first_enrollment.id != second_enrollment.id
    assert first_enrollment.virtual_key_id is None
    assert second_enrollment.virtual_key_id is None
    assert first_enrollment.litellm_team_id == second_enrollment.litellm_team_id
    assert first_enrollment.litellm_user_id == f"org-{organization.id}-user-{first}"
    assert second_enrollment.litellm_user_id == f"org-{organization.id}-user-{second}"
    assert first_enrollment.litellm_user_id != second_enrollment.litellm_user_id
    assert len(stub_litellm.minted) == 2 * len(AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS)

    first_keys = await store.list_active_enrollment_keys(
        db_session, enrollment_id=first_enrollment.id
    )
    second_keys = await store.list_active_enrollment_keys(
        db_session, enrollment_id=second_enrollment.id
    )
    first_key_ids = {key.virtual_key_id for key in first_keys}
    second_key_ids = {key.virtual_key_id for key in second_keys}
    # No overlap: every member's keys are distinct, even for the same harness.
    assert first_key_ids.isdisjoint(second_key_ids)


@pytest.mark.asyncio
async def test_same_member_in_two_orgs_gets_two_org_scoped_litellm_users(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """Never one global LiteLLM user spanning orgs (model-gateway.md).

    The per-(org, member) identity is what makes any user-scoped LiteLLM
    control (e.g. a per-member cap) org-scoped by construction; the old
    shared ``user-<id>`` identity would leak such a control across every org
    the member belongs to.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    member_id = await _create_user(db_session)
    first_org = await _place_in_org(db_session, user_id=member_id)
    second_org = await _place_in_org(db_session, user_id=member_id)

    first = await ensure_org_enrollment(db_session, first_org, member_id)
    second = await ensure_org_enrollment(db_session, second_org, member_id)

    assert first.litellm_user_id == f"org-{first_org}-user-{member_id}"
    assert second.litellm_user_id == f"org-{second_org}-user-{member_id}"
    assert first.litellm_user_id != second.litellm_user_id
    assert first.litellm_team_id != second.litellm_team_id
    assert f"user-{member_id}" not in stub_litellm.users


@pytest.mark.asyncio
async def test_signup_enrollment_recovers_orphaned_key_on_retry(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """A mint that landed but never committed must not wedge the retry.

    Simulated on the "claude" child key specifically — orphan recovery is
    per-(enrollment, harness), so this proves one harness's crash doesn't
    force a re-mint of the other three already-synced harness keys.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    user_id = await _create_user(db_session)
    await _place_in_org(db_session, user_id=user_id)

    enrollment = await ensure_signup_enrollment(db_session, user_id)
    assert enrollment is not None
    assert enrollment.sync_status == "synced"
    assert len(stub_litellm.minted) == len(AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS)
    claude_key = await store.get_active_enrollment_key(
        db_session, enrollment_id=enrollment.id, harness_kind="claude"
    )
    assert claude_key is not None
    orphan_alias = next(
        record["alias"]
        for record in stub_litellm.minted
        if record["metadata"]["proliferate_harness_kind"] == "claude"
    )
    # The alias is still live in LiteLLM (the orphan).
    assert orphan_alias in stub_litellm.live_aliases

    # Simulate a crash/rollback between mint and DB write: the child key row
    # forgets the key while LiteLLM still holds the alias. Flipping the
    # parent enrollment back to pending (mirroring the backfill trigger) is
    # what makes the next signup pass re-enter `_sync_enrollment` and
    # re-attempt this harness.
    key_row = await db_session.get(AgentGatewayEnrollmentKey, claude_key.id)
    assert key_row is not None
    key_row.virtual_key_id = None
    key_row.virtual_key_ciphertext = None
    key_row.virtual_key_ciphertext_key_id = None
    enrollment_row = await db_session.get(AgentGatewayEnrollment, enrollment.id)
    assert enrollment_row is not None
    enrollment_row.sync_status = "pending"
    await db_session.flush()

    # The retry must adopt-by-purge the orphan and re-mint (no duplicate-alias
    # 400) for "claude" only — the other three harnesses' keys are untouched.
    retried = await ensure_signup_enrollment(db_session, user_id)
    assert retried is not None
    assert retried.sync_status == "synced"
    assert len(stub_litellm.minted) == len(AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS) + 1
    assert orphan_alias in stub_litellm.deleted_aliases
    # Exactly one live key remains under the deterministic alias.
    assert orphan_alias in stub_litellm.live_aliases
    retried_claude_key = await store.get_active_enrollment_key(
        db_session, enrollment_id=enrollment.id, harness_kind="claude"
    )
    assert retried_claude_key is not None
    assert (
        await store.get_enrollment_key_virtual_key_decrypted(
            db_session,
            enrollment_key_id=retried_claude_key.id,
        )
        is not None
    )


@pytest.mark.asyncio
async def test_exhausted_grant_yields_blocked_budget_not_uncapped(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """A granted-but-exhausted subject must mirror a near-zero (blocked) cap.

    Flooring the mirrored budget at exactly "0" would parse as *uncapped*
    (org-default semantics), minting an unbounded key for an out-of-credit
    subject. The floor must be a tiny positive value instead.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    user_id = await _create_user(db_session)
    org_id = await _place_in_org(db_session, user_id=user_id)
    subject = await ensure_organization_billing_subject(db_session, org_id)

    # Grant $1, then debit $5 of usage so remaining credit is negative.
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject.id,
        source=LLM_CREDIT_SOURCE_ADMIN,
        amount_usd=Decimal("1"),
        user_id=user_id,
    )
    await store.insert_usage_event_once(
        db_session,
        litellm_request_id="req-exhaust-budget",
        occurred_at=datetime(2026, 7, 1, 12, 0, tzinfo=UTC),
        billing_subject_id=subject.id,
        cost_usd=5.0,
    )
    balance = await store.get_remaining_credit_usd(db_session, subject.id)
    assert balance.remaining_usd < Decimal("0")

    budget_raw = await _remaining_credit_budget_raw(
        db_session,
        billing_subject_id=subject.id,
        fallback=settings.agent_gateway_default_org_budget_usd,
    )
    parsed = _parse_budget(budget_raw)
    # Not uncapped (None), not the default fallback — a real, tiny positive cap.
    assert parsed is not None
    assert 0 < parsed <= 0.01


@pytest.mark.asyncio
async def test_no_grant_and_no_configured_budget_mirrors_the_floor(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """D3 (mirror): a subject with no grant and a "0" fallback is unfunded.

    The old branch returned the fallback verbatim, which ``_parse_budget``
    reads as *uncapped* — the "no grant means unlimited" hole. Unfunded now
    mirrors the exhausted floor; an explicitly configured positive fallback is
    still honored as the deployment's funding source.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    user_id = await _create_user(db_session)
    org_id = await _place_in_org(db_session, user_id=user_id)
    subject = await ensure_organization_billing_subject(db_session, org_id)

    unfunded = await _remaining_credit_budget_raw(
        db_session,
        billing_subject_id=subject.id,
        fallback="0",
    )
    parsed = _parse_budget(unfunded)
    assert parsed is not None
    assert 0 < parsed <= 0.01

    configured = await _remaining_credit_budget_raw(
        db_session,
        billing_subject_id=subject.id,
        fallback="250",
    )
    assert _parse_budget(configured) == 250.0


@pytest.mark.asyncio
async def test_backfill_creates_no_rows_for_org_less_users(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """Bare-user discovery is gone: backfill never mints a personal enrollment.

    A user with no active membership has no org to bill (org-only account
    model), so the backfill leaves them alone; membership discovery enrolls
    them the moment a membership exists.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    first = await _create_user(db_session)
    second = await _create_user(db_session)

    processed = await backfill_enrollments(db_session, limit=10)

    assert processed == 0
    for user_id in (first, second):
        assert await _no_personal_enrollment(db_session, user_id)
    assert stub_litellm.minted == []


@pytest.mark.asyncio
async def test_backfill_recovers_org_members_without_enrollment(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """A lost signup/org-join hook is recovered via membership discovery."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    member_id = await _create_user(db_session)
    # Active membership exists but the enrollment hook never ran.
    org_id = await _place_in_org(db_session, user_id=member_id, name="Backfill Org")

    processed = await backfill_enrollments(db_session, limit=50)

    assert processed >= 1
    enrollment = await store.get_enrollment_for_organization(
        db_session,
        organization_id=org_id,
        user_id=member_id,
    )
    assert enrollment is not None
    assert enrollment.sync_status == "synced"
    assert enrollment.user_id == member_id
    assert enrollment.litellm_user_id == f"org-{org_id}-user-{member_id}"
    # No personal row was minted along the way.
    assert await _no_personal_enrollment(db_session, member_id)


@pytest.mark.asyncio
async def test_backfill_bounds_work_per_tick(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    for _ in range(3):
        user_id = await _create_user(db_session)
        await _place_in_org(db_session, user_id=user_id)

    processed = await backfill_enrollments(db_session, limit=2)
    assert processed == 2
