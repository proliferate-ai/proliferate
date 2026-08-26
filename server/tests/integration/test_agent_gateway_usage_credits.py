"""Usage importer + LLM credit integration tests (real Postgres, stubbed LiteLLM).

Signups are org-only (model-gateway.md §Account model): the enrolled subject
is the user's default org, the free signup grant lands on that org's billing
subject, and spend imports debit the org ledger. Proof ledger: D2 (one free
grant per GitHub identity, ever; creating orgs mints nothing) lives here.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.auth import AuthIdentity, User
from proliferate.db.models.agent_gateway import AgentLlmUsageEvent
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.agent_gateway import AgentGatewayEnrollmentRecord
from proliferate.db.store.billing_subjects import (
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.integrations.litellm import LiteLLMSpendLogEntry
from proliferate.server.agent_auth import enrollment as enrollment_service
from proliferate.server.agent_auth import usage_import as usage_import_service
from proliferate.server.agent_auth.enrollment import (
    ensure_org_enrollment,
    ensure_signup_enrollment,
)
from proliferate.server.agent_auth.free_credits import ensure_signup_free_credit_grant
from proliferate.server.agent_auth.usage_import import (
    is_gateway_budget_available,
    run_usage_import,
)


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


async def _link_github_identity(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    provider_subject: str | None = None,
) -> str:
    subject = provider_subject or f"gh-{uuid.uuid4().hex[:12]}"
    db_session.add(
        AuthIdentity(
            user_id=user_id,
            provider="github",
            provider_subject=subject,
            email=f"gh-{uuid.uuid4().hex[:8]}@example.com",
            email_verified=True,
        )
    )
    await db_session.flush()
    return subject


async def _place_in_org(db_session: AsyncSession, *, user_id: uuid.UUID) -> uuid.UUID:
    """Create an org with an active membership for the user (signup placement)."""
    organization = Organization(name=f"Usage Org {uuid.uuid4().hex[:6]}")
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


async def _signup_enrollment(
    db_session: AsyncSession, user_id: uuid.UUID
) -> AgentGatewayEnrollmentRecord:
    """The org-only signup shape: default org placement + enrollment."""
    await _place_in_org(db_session, user_id=user_id)
    enrollment = await ensure_signup_enrollment(db_session, user_id)
    assert enrollment is not None
    return enrollment


async def _claude_key_id(db_session: AsyncSession, enrollment_id: uuid.UUID) -> str:
    """The "claude" per-harness child key's virtual_key_id for an enrollment.

    Post-B2 the parent enrollment row carries no key of its own — every
    gateway-capable harness gets its own child key (model-gateway.md
    §Account model). Tests here drive spend rows tagged ``claude-sonnet-4-5``,
    so "claude" is the representative per-harness key throughout this file.
    """
    enrollment_key = await store.get_active_enrollment_key(
        db_session, enrollment_id=enrollment_id, harness_kind="claude"
    )
    assert enrollment_key is not None
    assert enrollment_key.virtual_key_id is not None
    return enrollment_key.virtual_key_id


class StubLiteLLM:
    """Stubs the admin surfaces the enrollment + importer services call."""

    def __init__(self) -> None:
        self.teams: dict[str, str] = {}
        self.users: set[str] = set()
        self.minted: list[dict[str, object]] = []
        self.disabled_keys: list[str] = []
        self.spend_rows: list[LiteLLMSpendLogEntry] = []
        self.token_counter = 0
        self.last_spend_query: dict[str, str] | None = None
        # When True, page_spend_logs mirrors LiteLLM's real date semantics:
        # bounds are parsed at midnight and rows are filtered to
        # ``start 00:00 <= startTime <= end 00:00``.
        self.enforce_date_window = False

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for target in (enrollment_service.litellm, usage_import_service.litellm):
            monkeypatch.setattr(target, "ensure_team", self.ensure_team, raising=False)
            monkeypatch.setattr(target, "ensure_user", self.ensure_user, raising=False)
            monkeypatch.setattr(target, "mint_virtual_key", self.mint_virtual_key, raising=False)
            monkeypatch.setattr(
                target, "disable_virtual_key", self.disable_virtual_key, raising=False
            )
            monkeypatch.setattr(target, "page_spend_logs", self.page_spend_logs, raising=False)

    async def ensure_team(
        self,
        *,
        alias: str,
        max_budget: float | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        return self.teams.setdefault(alias, f"team-{alias}")

    async def ensure_user(self, *, user_id: str, metadata: dict[str, Any] | None = None) -> str:
        self.users.add(user_id)
        return user_id

    async def mint_virtual_key(
        self,
        *,
        user_id: str,
        team_id: str | None = None,
        alias: str | None = None,
        max_budget: float | None = None,
        metadata: dict[str, object] | None = None,
        models: list[str] | None = None,
    ):
        self.token_counter += 1
        token_id = f"token-{self.token_counter}"
        self.minted.append(
            {
                "alias": alias,
                "token_id": token_id,
                "metadata": metadata or {},
                "models": models,
            }
        )
        from proliferate.integrations.litellm import LiteLLMVirtualKey

        return LiteLLMVirtualKey(
            key=f"sk-litellm-{self.token_counter}",
            token_id=token_id,
            key_alias=alias,
            user_id=user_id,
            team_id=team_id,
            max_budget=max_budget,
        )

    async def disable_virtual_key(self, *, key_or_token_id: str) -> None:
        self.disabled_keys.append(key_or_token_id)

    async def page_spend_logs(
        self, *, start_date: str, end_date: str
    ) -> list[LiteLLMSpendLogEntry]:
        self.last_spend_query = {"start_date": start_date, "end_date": end_date}
        if not self.enforce_date_window:
            return list(self.spend_rows)
        start = datetime.fromisoformat(start_date).replace(tzinfo=UTC)
        end = datetime.fromisoformat(end_date).replace(tzinfo=UTC)
        kept: list[LiteLLMSpendLogEntry] = []
        for row in self.spend_rows:
            raw = row.end_time or row.start_time
            if raw is None:
                continue
            ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if start <= ts <= end:
                kept.append(row)
        return kept


@pytest.fixture
def stub_litellm(monkeypatch: pytest.MonkeyPatch) -> StubLiteLLM:
    stub = StubLiteLLM()
    stub.install(monkeypatch)
    return stub


def _spend_row(
    *,
    request_id: str,
    api_key: str,
    spend: float,
    occurred_at: datetime,
) -> LiteLLMSpendLogEntry:
    return LiteLLMSpendLogEntry.model_validate(
        {
            "request_id": request_id,
            "api_key": api_key,
            "model": "claude-sonnet-4-5",
            "spend": spend,
            "total_tokens": 120,
            "prompt_tokens": 100,
            "completion_tokens": 20,
            "endTime": occurred_at.isoformat(),
        }
    )


@pytest.mark.asyncio
async def test_free_credit_lands_on_default_org_once_and_deduped(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The signup grant lands on the default org's billing subject, never the
    personal one, and repeated passes never double-credit."""
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    org_id = await _place_in_org(db_session, user_id=user_id)

    first = await ensure_signup_free_credit_grant(db_session, user_id)
    second = await ensure_signup_free_credit_grant(db_session, user_id)
    assert first is True
    assert second is True  # idempotent: returns the existing grant

    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    balance = await store.get_remaining_credit_usd(db_session, org_subject.id)
    assert balance.granted_usd == Decimal("5")  # not doubled
    assert balance.remaining_usd == Decimal("5")
    personal_subject = await ensure_personal_billing_subject(db_session, user_id)
    personal_balance = await store.get_remaining_credit_usd(db_session, personal_subject.id)
    assert personal_balance.granted_usd == Decimal("0")


@pytest.mark.asyncio
async def test_free_credit_skipped_without_github_identity(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)
    await _place_in_org(db_session, user_id=user_id)

    granted = await ensure_signup_free_credit_grant(db_session, user_id)
    assert granted is False


@pytest.mark.asyncio
async def test_free_credit_skipped_without_default_org(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No default org yet → nothing to land the grant on; nothing personal
    is minted in its place."""
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)

    granted = await ensure_signup_free_credit_grant(db_session, user_id)
    assert granted is False
    personal_subject = await ensure_personal_billing_subject(db_session, user_id)
    balance = await store.get_remaining_credit_usd(db_session, personal_subject.id)
    assert balance.granted_usd == Decimal("0")


@pytest.mark.asyncio
async def test_d2_second_account_on_same_github_identity_gets_no_grant(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D2 (half 1): one grant per GitHub identity, ever.

    A second product account on the same GitHub identity (the human unlinked
    it from the first account and linked it to a fresh one) — its own default
    org and all — reserves nothing: the ``free_cloud_allocation`` row already
    belongs to the first account's default-org subject.
    """
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    first_user = await _create_user(db_session)
    github_subject = await _link_github_identity(db_session, user_id=first_user)
    first_org = await _place_in_org(db_session, user_id=first_user)
    assert await ensure_signup_free_credit_grant(db_session, first_user) is True

    second_user = await _create_user(db_session)
    # Move the identity: AuthIdentity is unique per (provider, subject), so a
    # "second account on the same identity" is a re-linked row.
    identity = (
        await db_session.execute(
            select(AuthIdentity).where(
                AuthIdentity.provider == "github",
                AuthIdentity.provider_subject == github_subject,
            )
        )
    ).scalar_one()
    identity.user_id = second_user
    await db_session.flush()
    second_org = await _place_in_org(db_session, user_id=second_user)

    assert await ensure_signup_free_credit_grant(db_session, second_user) is False
    second_subject = await ensure_organization_billing_subject(db_session, second_org)
    balance = await store.get_remaining_credit_usd(db_session, second_subject.id)
    assert balance.granted_usd == Decimal("0")
    first_subject = await ensure_organization_billing_subject(db_session, first_org)
    first_balance = await store.get_remaining_credit_usd(db_session, first_subject.id)
    assert first_balance.granted_usd == Decimal("5")


@pytest.mark.asyncio
async def test_d2_creating_additional_orgs_mints_nothing(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """D2 (half 2): joining/creating more orgs never mints another grant.

    The member's enrollment into a second org re-runs the deduped grant, but
    the credit stays on the DEFAULT org's subject: the joining member never
    brings their free grant into the new org (invite-farming is worthless).
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    default_org = await _place_in_org(db_session, user_id=user_id)
    enrollment = await ensure_signup_enrollment(db_session, user_id)
    assert enrollment is not None

    # The user later creates/joins a second org; its member enrollment runs.
    later_org = await _place_in_org(db_session, user_id=user_id)
    await ensure_org_enrollment(db_session, later_org, user_id)

    default_subject = await ensure_organization_billing_subject(db_session, default_org)
    later_subject = await ensure_organization_billing_subject(db_session, later_org)
    default_balance = await store.get_remaining_credit_usd(db_session, default_subject.id)
    later_balance = await store.get_remaining_credit_usd(db_session, later_subject.id)
    assert default_balance.granted_usd == Decimal("5")  # still exactly one grant
    assert later_balance.granted_usd == Decimal("0")


@pytest.mark.asyncio
async def test_pre_migration_personal_claim_blocks_the_org_grant(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An identity that already claimed on a personal subject gets nothing.

    Pre-D-2 users hold their free grant on the personal billing subject; the
    org-targeted grant must see the claimed allocation and refuse, or the
    D-3 migration window would double-credit every existing user.
    """
    from proliferate.constants.agent_gateway import (
        AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
        LLM_CREDIT_SOURCE_FREE_SIGNUP,
    )
    from proliferate.db.store.billing_subjects import (
        ensure_agent_gateway_free_credit_allocation,
    )

    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    # Legacy claim: allocation + grant on the personal subject (pre-D-2 shape).
    personal_subject = await ensure_personal_billing_subject(db_session, user_id)
    assert (
        await ensure_agent_gateway_free_credit_allocation(
            db_session,
            user_id=user_id,
            billing_subject=personal_subject,
            period_key=AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
        )
        is True
    )
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=personal_subject.id,
        user_id=user_id,
        source=LLM_CREDIT_SOURCE_FREE_SIGNUP,
        amount_usd=Decimal("5"),
        source_ref=f"{LLM_CREDIT_SOURCE_FREE_SIGNUP}:{personal_subject.id}",
    )

    org_id = await _place_in_org(db_session, user_id=user_id)
    assert await ensure_signup_free_credit_grant(db_session, user_id) is False

    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    org_balance = await store.get_remaining_credit_usd(db_session, org_subject.id)
    assert org_balance.granted_usd == Decimal("0")
    personal_balance = await store.get_remaining_credit_usd(db_session, personal_subject.id)
    assert personal_balance.granted_usd == Decimal("5")  # untouched, not doubled


@pytest.mark.asyncio
async def test_importer_is_idempotent_across_overlapping_windows(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    enrollment = await _signup_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is None
    claude_key_id = await _claude_key_id(db_session, enrollment.id)

    occurred = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
    stub_litellm.spend_rows = [
        _spend_row(
            request_id="req-1",
            api_key=claude_key_id,
            spend=0.10,
            occurred_at=occurred,
        )
    ]

    first = await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 10, tzinfo=UTC))
    assert first.imported == 1
    assert first.skipped_duplicate == 0

    # Second tick: the same row is inside the overlap window; dedupe holds.
    second = await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 15, tzinfo=UTC))
    assert second.imported == 0
    assert second.skipped_duplicate == 1

    total_rows = await db_session.scalar(select(func.count()).select_from(AgentLlmUsageEvent))
    assert total_rows == 1

    subject_id = enrollment.billing_subject_id
    balance = await store.get_remaining_credit_usd(db_session, subject_id)
    # Ruled 2026-07-14: managed LLM is metered at provider list + 15%, so a
    # $0.10 provider spend debits $0.115 against the credit ledger.
    assert balance.used_usd == Decimal("0.115")
    assert balance.remaining_usd == Decimal("4.885")


@pytest.mark.asyncio
async def test_same_day_spend_is_imported(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """A row logged earlier *today* must be imported on the same day.

    LiteLLM bounds ``end_date`` at midnight, so an ``end_date`` of ``now.date()``
    excludes everything logged since 00:00 today. The importer must widen the
    window to ``now + 1 day``; this regresses to ``imported == 0`` if it does
    not.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    stub_litellm.enforce_date_window = True
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    enrollment = await _signup_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is None
    claude_key_id = await _claude_key_id(db_session, enrollment.id)

    now = datetime(2026, 7, 1, 12, 10, tzinfo=UTC)
    occurred = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)  # earlier the same day
    stub_litellm.spend_rows = [
        _spend_row(
            request_id="req-today",
            api_key=claude_key_id,
            spend=0.10,
            occurred_at=occurred,
        )
    ]

    result = await run_usage_import(db_session, now=now)
    assert result.imported == 1
    assert stub_litellm.last_spend_query is not None
    # end_date must reach past today for LiteLLM's midnight-bounded filter.
    assert stub_litellm.last_spend_query["end_date"] == "2026-07-02"


@pytest.mark.asyncio
async def test_exhaustion_disables_key_and_flips_budget_status(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "0.001")
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    enrollment = await _signup_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is None
    assert enrollment.budget_status == "ok"
    claude_key_id = await _claude_key_id(db_session, enrollment.id)
    all_key_ids = {
        key.virtual_key_id
        for key in await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment.id)
    }

    occurred = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
    stub_litellm.spend_rows = [
        _spend_row(
            request_id="req-exhaust",
            api_key=claude_key_id,
            spend=0.05,  # far past the 0.001 grant
            occurred_at=occurred,
        )
    ]

    result = await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 10, tzinfo=UTC))
    assert result.imported == 1
    assert result.exhausted_subjects == 1

    # Every per-harness key was disabled via the LiteLLM admin client
    # (exhaustion is subject-wide, not per-harness).
    assert set(stub_litellm.disabled_keys) == all_key_ids

    refreshed = await store.get_enrollment_by_id(db_session, enrollment_id=enrollment.id)
    assert refreshed is not None
    assert refreshed.budget_status == "exhausted"

    balance = await store.get_remaining_credit_usd(db_session, enrollment.billing_subject_id)
    assert balance.remaining_usd < Decimal("0")

    # Re-running does not re-disable an already-exhausted key.
    again = await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 20, tzinfo=UTC))
    assert again.exhausted_subjects == 0
    assert set(stub_litellm.disabled_keys) == all_key_ids


@pytest.mark.asyncio
async def test_unresolved_key_row_is_flagged_needs_review(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    occurred = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
    stub_litellm.spend_rows = [
        _spend_row(
            request_id="req-orphan",
            api_key="token-does-not-exist",
            spend=0.02,
            occurred_at=occurred,
        )
    ]

    result = await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 10, tzinfo=UTC))
    assert result.imported == 1
    assert result.unresolved == 1

    row = (
        await db_session.execute(
            select(AgentLlmUsageEvent).where(AgentLlmUsageEvent.litellm_request_id == "req-orphan")
        )
    ).scalar_one()
    assert row.status == "needs_review"
    assert row.billing_subject_id is None


@pytest.mark.asyncio
async def test_is_gateway_budget_available(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    enrollment = await _signup_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is None
    claude_key_id = await _claude_key_id(db_session, enrollment.id)

    # Fresh grant, no usage → available.
    assert await is_gateway_budget_available(db_session, user_id) is True

    # Spend past the grant → unavailable.
    stub_litellm.spend_rows = [
        _spend_row(
            request_id="req-drain",
            api_key=claude_key_id,
            spend=6.0,
            occurred_at=datetime(2026, 7, 1, 12, 0, tzinfo=UTC),
        )
    ]
    await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 10, tzinfo=UTC))
    assert await is_gateway_budget_available(db_session, user_id) is False

    # A user with no enrollment at all is never blocked by the ledger.
    other_id = await _create_user(db_session)
    assert await is_gateway_budget_available(db_session, other_id) is True


@pytest.mark.asyncio
async def test_gateway_disabled_makes_budget_always_available(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    user_id = await _create_user(db_session)
    assert await is_gateway_budget_available(db_session, user_id) is True


@pytest.mark.asyncio
async def test_exhausted_budget_withholds_gateway_key_from_state_render(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """The second enforcement wall: state.json stops carrying the virtual key.

    Even if the LiteLLM key-disable (first wall) lagged or failed, an
    exhausted subject's agent-auth state render must drop the gateway source,
    so the runtime fails closed at launch.
    """
    from proliferate.db.store.agent_gateway import DesiredAuthSource
    from proliferate.db.store.agent_gateway.selections import put_auth_selections
    from proliferate.server.agent_auth.state_render import (
        build_agent_auth_state,
    )

    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    monkeypatch.setattr(
        settings,
        "agent_gateway_litellm_public_base_url",
        "https://llm.proliferate.ai",
    )
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    enrollment = await _signup_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is None
    claude_key_id = await _claude_key_id(db_session, enrollment.id)

    await put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="local",
        sources=[DesiredAuthSource(source_kind="gateway")],
    )

    # With credit remaining, the render hands out the claude harness's own
    # per-harness gateway key (model-gateway.md §Account model). `claude_key_id`
    # is the token hash (spend-log `api_key`), not the rendered secret value —
    # only presence is asserted here.
    state, _ = await build_agent_auth_state(db_session, user_id, surface="local")
    sources = [s for h in state["harnesses"] for s in h["sources"]]
    assert any(s["kind"] == "gateway" and s.get("key") for s in sources)

    # Drain the grant; simulate the first wall failing by NOT relying on the
    # key-disable — the render alone must now withhold the key regardless.
    stub_litellm.spend_rows = [
        _spend_row(
            request_id="req-wall2",
            api_key=claude_key_id,
            spend=6.0,
            occurred_at=datetime(2026, 7, 1, 12, 0, tzinfo=UTC),
        )
    ]
    await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 10, tzinfo=UTC))
    assert await is_gateway_budget_available(db_session, user_id) is False

    state, _ = await build_agent_auth_state(db_session, user_id, surface="local")
    sources = [s for h in state["harnesses"] for s in h["sources"]]
    assert not any(s["kind"] == "gateway" for s in sources)


@pytest.mark.asyncio
async def test_configured_default_budget_keeps_a_grantless_subject_open(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """An explicitly configured positive default budget is a funding source.

    With no grant but a real configured budget, the LiteLLM team budget is the
    guardrail — the ledger gate stays open and the render hands out the key.
    """
    from proliferate.db.store.agent_gateway import DesiredAuthSource
    from proliferate.db.store.agent_gateway.selections import put_auth_selections
    from proliferate.server.agent_auth.state_render import (
        build_agent_auth_state,
    )

    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    # Free credits disabled: no grant. The explicit default budget funds it.
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "0")
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "5")
    monkeypatch.setattr(
        settings,
        "agent_gateway_litellm_public_base_url",
        "https://llm.proliferate.ai",
    )
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    enrollment = await _signup_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is None

    await put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="local",
        sources=[DesiredAuthSource(source_kind="gateway")],
    )
    assert await is_gateway_budget_available(db_session, user_id) is True
    state, _ = await build_agent_auth_state(db_session, user_id, surface="local")
    sources = [s for h in state["harnesses"] for s in h["sources"]]
    assert any(s["kind"] == "gateway" and s.get("key") for s in sources)


@pytest.mark.asyncio
async def test_unfunded_subject_fails_closed_at_gate_and_render(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """D3: no grant and no configured budget → gate refuses, render withholds.

    Replaces the deleted "no grant means unlimited" assertion: an unfunded
    subject used to sail through the ledger gate (and, org-side, get an
    uncapped LiteLLM team). Now it fails closed — no key material is rendered,
    so the runtime refuses the launch.
    """
    from proliferate.db.store.agent_gateway import DesiredAuthSource
    from proliferate.db.store.agent_gateway.selections import put_auth_selections
    from proliferate.server.agent_auth.state_render import (
        build_agent_auth_state,
    )

    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "0")
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "0")
    monkeypatch.setattr(
        settings,
        "agent_gateway_litellm_public_base_url",
        "https://llm.proliferate.ai",
    )
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    enrollment = await _signup_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is None

    await put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="local",
        sources=[DesiredAuthSource(source_kind="gateway")],
    )
    assert await is_gateway_budget_available(db_session, user_id) is False
    state, _ = await build_agent_auth_state(db_session, user_id, surface="local")
    sources = [s for h in state["harnesses"] for s in h["sources"]]
    assert not any(s["kind"] == "gateway" for s in sources)
