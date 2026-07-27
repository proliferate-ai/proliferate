"""Enrollment service tests with a stubbed LiteLLM admin client."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS,
    LLM_CREDIT_SOURCE_ADMIN,
)
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.agent_gateway import (
    AgentGatewayEnrollment,
    AgentGatewayEnrollmentKey,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.integrations.litellm import LiteLLMIntegrationError, LiteLLMVirtualKey
from proliferate.server.cloud.agent_gateway import enrollment as enrollment_service
from proliferate.server.cloud.agent_gateway.enrollment import (
    _parse_budget,
    _remaining_credit_budget_raw,
    backfill_enrollments,
    ensure_org_enrollment,
    ensure_user_enrollment,
)


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
async def test_user_enrollment_stays_pending_when_gateway_disabled(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    user_id = await _create_user(db_session)

    enrollment = await ensure_user_enrollment(db_session, user_id)

    assert enrollment.sync_status == "pending"
    assert stub_litellm.minted == []


@pytest.mark.asyncio
async def test_user_enrollment_syncs_against_gateway(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    user_id = await _create_user(db_session)

    enrollment = await ensure_user_enrollment(db_session, user_id)

    assert enrollment.sync_status == "synced"
    assert enrollment.litellm_team_id == f"team-user-{user_id}"
    assert enrollment.litellm_user_id == f"user-{user_id}"
    # Post-B2: the parent row carries no key material of its own — every
    # gateway-capable harness gets its own child key (model-gateway.md
    # §Account model).
    assert enrollment.virtual_key_id is None
    assert enrollment.sync_fingerprint is not None
    assert f"user-{user_id}" in stub_litellm.users
    assert len(stub_litellm.minted) == len(AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS)

    enrollment_keys = await store.list_active_enrollment_keys(
        db_session, enrollment_id=enrollment.id
    )
    assert {key.harness_kind for key in enrollment_keys} == set(
        AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS
    )
    for enrollment_key in enrollment_keys:
        minted = next(
            record
            for record in stub_litellm.minted
            if record["metadata"]["proliferate_harness_kind"] == enrollment_key.harness_kind
        )
        # Access-group scoping: exactly the harness's own group, never a budget.
        assert minted["models"] == [enrollment_key.harness_kind]
        assert minted["max_budget"] is None
        assert minted["metadata"]["proliferate_user_id"] == str(user_id)
        assert minted["metadata"]["proliferate_harness_kind"] == enrollment_key.harness_kind
        assert minted["metadata"]["proliferate_billing_subject_id"] == str(
            enrollment.billing_subject_id
        )
        assert (
            await store.get_enrollment_key_virtual_key_decrypted(
                db_session,
                enrollment_key_id=enrollment_key.id,
            )
            is not None
        )

    again = await ensure_user_enrollment(db_session, user_id)
    assert again.id == enrollment.id
    assert len(stub_litellm.minted) == len(AGENT_AUTH_GATEWAY_CAPABLE_HARNESS_KINDS)


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

    await ensure_user_enrollment(db_session, user_id)

    expected = {
        "proliferate_qualification_run_id": "qlc-ci-123-1",
        "proliferate_qualification_shard_id": "1",
    }
    assert stub_litellm.team_metadata == [expected]
    assert stub_litellm.user_metadata == [expected]
    assert all(stub_litellm.minted[0]["metadata"][key] == value for key, value in expected.items())


@pytest.mark.asyncio
async def test_user_enrollment_marks_failed_on_litellm_error(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    stub_litellm.fail_mint = True
    user_id = await _create_user(db_session)

    enrollment = await ensure_user_enrollment(db_session, user_id)

    assert enrollment.sync_status == "failed"
    assert enrollment.last_error_code == "litellm_request_failed"
    assert enrollment.last_error_message == "mint exploded"

    # Backfill retries the failed row once LiteLLM recovers.
    stub_litellm.fail_mint = False
    processed = await backfill_enrollments(db_session, limit=10)
    assert processed >= 1
    retried = await store.get_enrollment_for_user(db_session, user_id=user_id)
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
    # Per member (spec §2.3): the key is attributed to the member's litellm user.
    assert enrollment.litellm_user_id == f"user-{member_id}"
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
    from proliferate.db.store.billing_subjects import ensure_organization_billing_subject

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
    # per-harness child keys (post-B2: the parent row carries no key itself).
    assert first_enrollment.id != second_enrollment.id
    assert first_enrollment.virtual_key_id is None
    assert second_enrollment.virtual_key_id is None
    assert first_enrollment.litellm_team_id == second_enrollment.litellm_team_id
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
async def test_user_enrollment_recovers_orphaned_key_on_retry(
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

    enrollment = await ensure_user_enrollment(db_session, user_id)
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
    # parent enrollment back to pending (mirroring the migration backfill
    # trigger) is what makes `ensure_user_enrollment` re-enter `_sync_enrollment`
    # and re-attempt this harness.
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
    retried = await ensure_user_enrollment(db_session, user_id)
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
    subject = await ensure_personal_billing_subject(db_session, user_id)

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
        fallback=settings.agent_gateway_default_user_budget_usd,
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
    subject = await ensure_personal_billing_subject(db_session, user_id)

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
async def test_backfill_discovers_users_without_enrollment_rows(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    first = await _create_user(db_session)
    second = await _create_user(db_session)

    processed = await backfill_enrollments(db_session, limit=10)

    assert processed >= 2
    for user_id in (first, second):
        enrollment = await store.get_enrollment_for_user(db_session, user_id=user_id)
        assert enrollment is not None
        assert enrollment.sync_status == "synced"


@pytest.mark.asyncio
async def test_backfill_recovers_org_members_without_enrollment(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """A lost org-join hook is recovered symmetrically to personal enrollment."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    organization = Organization(name="Backfill Org")
    db_session.add(organization)
    await db_session.flush()
    member_id = await _create_user(db_session)
    # Active membership exists but the org enrollment hook never ran.
    db_session.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=member_id,
            role="member",
            status="active",
        )
    )
    await db_session.flush()

    processed = await backfill_enrollments(db_session, limit=50)

    assert processed >= 1
    enrollment = await store.get_enrollment_for_organization(
        db_session,
        organization_id=organization.id,
        user_id=member_id,
    )
    assert enrollment is not None
    assert enrollment.sync_status == "synced"
    assert enrollment.user_id == member_id


@pytest.mark.asyncio
async def test_backfill_bounds_work_per_tick(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    for _ in range(3):
        await _create_user(db_session)

    processed = await backfill_enrollments(db_session, limit=2)
    assert processed == 2
