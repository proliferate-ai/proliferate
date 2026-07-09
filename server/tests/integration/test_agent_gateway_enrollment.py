"""Enrollment service tests with a stubbed LiteLLM admin client."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import LLM_CREDIT_SOURCE_ADMIN
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.agent_gateway import AgentGatewayEnrollment
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

    async def ensure_team(self, *, alias: str, max_budget: float | None = None) -> str:
        team_id = self.teams.setdefault(alias, f"team-{alias}")
        return team_id

    async def ensure_user(self, *, user_id: str) -> str:
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
    assert enrollment.virtual_key_id == "token-1"
    assert enrollment.sync_fingerprint is not None
    assert f"user-{user_id}" in stub_litellm.users
    minted = stub_litellm.minted[0]
    assert minted["metadata"]["proliferate_user_id"] == str(user_id)
    assert minted["metadata"]["proliferate_billing_subject_id"] == str(
        enrollment.billing_subject_id
    )
    assert minted["max_budget"] == 5.0
    assert (
        await store.get_enrollment_virtual_key_decrypted(
            db_session,
            enrollment_id=enrollment.id,
        )
        == "sk-litellm-1"
    )

    again = await ensure_user_enrollment(db_session, user_id)
    assert again.id == enrollment.id
    assert len(stub_litellm.minted) == 1


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
async def test_org_enrollment_syncs_without_budget_cap(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
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
    minted = stub_litellm.minted[0]
    # Default org budget "0" means uncapped: no budget forwarded.
    assert minted["max_budget"] is None
    assert minted["metadata"]["proliferate_organization_id"] == str(organization.id)
    assert minted["metadata"]["proliferate_user_id"] == str(member_id)


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

    # Distinct rows and distinct virtual keys under the same shared org team.
    assert first_enrollment.id != second_enrollment.id
    assert first_enrollment.virtual_key_id != second_enrollment.virtual_key_id
    assert first_enrollment.litellm_team_id == second_enrollment.litellm_team_id
    assert len(stub_litellm.minted) == 2


@pytest.mark.asyncio
async def test_user_enrollment_recovers_orphaned_key_on_retry(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """A mint that landed but never committed must not wedge the retry."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    user_id = await _create_user(db_session)

    enrollment = await ensure_user_enrollment(db_session, user_id)
    assert enrollment.sync_status == "synced"
    assert len(stub_litellm.minted) == 1
    orphan_alias = stub_litellm.minted[0]["alias"]
    # The alias is still live in LiteLLM (the orphan).
    assert orphan_alias in stub_litellm.live_aliases

    # Simulate a crash/rollback between mint and DB write: the key id was never
    # persisted, so the row forgets the key while LiteLLM still holds the alias.
    row = await db_session.get(AgentGatewayEnrollment, enrollment.id)
    assert row is not None
    row.virtual_key_id = None
    row.virtual_key_ciphertext = None
    row.virtual_key_ciphertext_key_id = None
    row.sync_status = "failed"
    await db_session.flush()

    # The retry must adopt-by-purge the orphan and re-mint (no duplicate-alias 400).
    retried = await ensure_user_enrollment(db_session, user_id)
    assert retried.sync_status == "synced"
    assert retried.virtual_key_id is not None
    assert len(stub_litellm.minted) == 2
    assert orphan_alias in stub_litellm.deleted_aliases
    # Exactly one live key remains under the deterministic alias.
    assert orphan_alias in stub_litellm.live_aliases
    assert (
        await store.get_enrollment_virtual_key_decrypted(
            db_session,
            enrollment_id=enrollment.id,
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
