"""D-3 enrollment migration tests (real Postgres, stubbed LiteLLM).

Proof ledger **D6** (model-gateway.md §Proof): the migration re-parents a
personal enrollment onto the default org, re-mints keys under the per-org
LiteLLM user, revokes the old keys, is idempotent on re-run, and a session
launched after it works (proven here at the state-render seam the runtime
launches from). Also the converted-grant accounting — remaining credit is
preserved, never duplicated (the GitHub-identity claim converts) — plus the
stale-identity org sweep and the grep-gates the org-only cut demands (the
personal-subject path, the resolver fallback, the funding guard, and the
name-ordered org choice are GONE from the codebase).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
    LLM_CREDIT_SOURCE_FREE_SIGNUP,
)
from proliferate.db.models.auth import AuthIdentity, User
from proliferate.db.models.billing import FreeCloudAllocation
from proliferate.db.models.agent_gateway import (
    AgentGatewayEnrollment,
    LlmCreditGrant,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.agent_gateway import DesiredAuthSource
from proliferate.db.store.agent_gateway.selections import put_auth_selections
from proliferate.db.store.billing_subjects import (
    ensure_agent_gateway_free_credit_allocation,
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.integrations.litellm import LiteLLMIntegrationError, LiteLLMVirtualKey
from proliferate.server.ai_gateway import budget as budget_module
from proliferate.server.ai_gateway import enrollment as enrollment_service
from proliferate.server.ai_gateway import migration as migration_service
from proliferate.server.ai_gateway.budget import get_gateway_enrollment_for_user
from proliferate.server.ai_gateway.enrollment import ensure_org_enrollment
from proliferate.server.ai_gateway.free_credits import ensure_signup_free_credit_grant
from proliferate.server.ai_gateway.migration import migrate_legacy_enrollments
from proliferate.server.agent_auth.state_render import (
    build_agent_auth_state,
)
from proliferate.lib.infra.time.wall_clock import utcnow

# Two harness kinds keep the mint/revoke ledgers legible; the mechanism is
# per-harness and identical for the full four-kind tuple.
_HARNESSES = ("claude", "codex")


class _StubLiteLLM:
    """Key-lifecycle-faithful stub: live keys, revocation, alias uniqueness."""

    def __init__(self) -> None:
        self.teams: dict[str, str] = {}
        self.users: set[str] = set()
        self.ensure_team_budgets: list[float | None] = []
        self.minted: list[dict[str, Any]] = []
        # token_id -> alias for every key the proxy currently holds.
        self.live_keys: dict[str, str | None] = {}
        self.deleted_tokens: list[str] = []
        self.deleted_aliases: list[str] = []
        self.team_budgets: list[tuple[str, float | None]] = []

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for target in (enrollment_service.litellm, migration_service.litellm):
            monkeypatch.setattr(target, "ensure_team", self.ensure_team, raising=False)
            monkeypatch.setattr(target, "ensure_user", self.ensure_user, raising=False)
            monkeypatch.setattr(target, "mint_virtual_key", self.mint_virtual_key, raising=False)
            monkeypatch.setattr(
                target, "delete_virtual_key", self.delete_virtual_key, raising=False
            )
            monkeypatch.setattr(
                target,
                "delete_virtual_keys_by_alias",
                self.delete_virtual_keys_by_alias,
                raising=False,
            )
            monkeypatch.setattr(
                target, "update_team_budget", self.update_team_budget, raising=False
            )

    def seed_key(self, token_id: str, alias: str | None = None) -> None:
        """A key that exists on the proxy from before the migration."""
        self.live_keys[token_id] = alias

    async def ensure_team(
        self,
        *,
        alias: str,
        max_budget: float | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        self.ensure_team_budgets.append(max_budget)
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
        metadata: dict[str, Any] | None = None,
        models: list[str] | None = None,
    ) -> LiteLLMVirtualKey:
        if alias is not None and alias in self.live_keys.values():
            raise LiteLLMIntegrationError(
                "litellm_request_failed",
                f"Unable to create key: key_alias {alias} already exists",
                status_code=400,
            )
        token_id = f"token-{len(self.minted) + 1}"
        self.minted.append({"user_id": user_id, "alias": alias, "models": models})
        self.live_keys[token_id] = alias
        return LiteLLMVirtualKey(
            key=f"sk-litellm-{token_id}",
            token_id=token_id,
            key_alias=alias,
            user_id=user_id,
            team_id=team_id,
            max_budget=max_budget,
        )

    async def delete_virtual_key(self, *, key_or_token_id: str) -> None:
        # Tolerates a missing key, mirroring the real client.
        if key_or_token_id in self.live_keys:
            del self.live_keys[key_or_token_id]
            self.deleted_tokens.append(key_or_token_id)

    async def update_team_budget(self, *, team_id: str, max_budget: float | None) -> None:
        self.team_budgets.append((team_id, max_budget))

    async def delete_virtual_keys_by_alias(self, *, alias: str) -> int:
        tokens = [token for token, live_alias in self.live_keys.items() if live_alias == alias]
        for token in tokens:
            del self.live_keys[token]
        if tokens:
            self.deleted_aliases.append(alias)
        return len(tokens)


@pytest.fixture
def migration_litellm(monkeypatch: pytest.MonkeyPatch) -> _StubLiteLLM:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    monkeypatch.setattr(settings, "agent_gateway_default_org_budget_usd", "0")
    monkeypatch.setattr(enrollment_service, "_GATEWAY_CAPABLE_HARNESS_KINDS", _HARNESSES)
    stub = _StubLiteLLM()
    stub.install(monkeypatch)
    return stub


async def _create_user(db_session: AsyncSession, *, with_github: bool = True) -> uuid.UUID:
    user = User(
        email=f"migrate-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    if with_github:
        subject = f"gh-{uuid.uuid4().hex[:12]}"
        db_session.add(
            AuthIdentity(
                user_id=user.id,
                provider="github",
                provider_subject=subject,
                email=f"{subject}@example.com",
                email_verified=True,
            )
        )
        await db_session.flush()
    return user.id


async def _place_in_org(db_session: AsyncSession, user_id: uuid.UUID) -> uuid.UUID:
    organization = Organization(name=f"Migrate Org {uuid.uuid4().hex[:6]}")
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


async def _pre_d2_personal_enrollment(
    db_session: AsyncSession,
    stub: _StubLiteLLM,
    user_id: uuid.UUID,
    *,
    claimed_grant_usd: str | None = "5",
    used_usd: float = 0.0,
) -> AgentGatewayEnrollment:
    """The full pre-D-2 personal shape, fabricated at the model level.

    ``user-<id>`` team + LiteLLM user, per-harness child keys live on the
    (stubbed) proxy, the free-signup grant claimed by the PERSONAL billing
    subject through the GitHub-identity allocation, and optional imported
    spend against it. No service path can produce this anymore.
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
        sync_fingerprint="pre-d2-personal",
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    await db_session.flush()
    for harness_kind in _HARNESSES:
        token = f"token-personal-{harness_kind}-{uuid.uuid4().hex[:6]}"
        stub.seed_key(token, alias=f"vk-user-{user_id}-{harness_kind}-{str(row.id)[:8]}")
        await store.upsert_enrollment_key(
            db_session,
            enrollment_id=row.id,
            harness_kind=harness_kind,
            virtual_key_id=token,
            virtual_key=f"sk-litellm-{token}",
            sync_fingerprint="pre-d2-key",
        )
    if claimed_grant_usd is not None:
        assert (
            await ensure_agent_gateway_free_credit_allocation(
                db_session,
                user_id=user_id,
                billing_subject=subject,
                period_key=AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
            )
            is True
        )
        await store.create_llm_credit_grant(
            db_session,
            billing_subject_id=subject.id,
            user_id=user_id,
            source=LLM_CREDIT_SOURCE_FREE_SIGNUP,
            amount_usd=Decimal(claimed_grant_usd),
            source_ref=f"{LLM_CREDIT_SOURCE_FREE_SIGNUP}:{subject.id}",
        )
    if used_usd > 0:
        await store.insert_usage_event_once(
            db_session,
            litellm_request_id=f"req-personal-{uuid.uuid4().hex[:8]}",
            occurred_at=datetime(2026, 7, 1, 12, 0, tzinfo=UTC),
            user_id=user_id,
            billing_subject_id=subject.id,
            cost_usd=used_usd,
        )
    return row


@pytest.mark.asyncio
async def test_d6_migration_reparents_personal_enrollment_end_to_end(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    migration_litellm: _StubLiteLLM,
) -> None:
    """D6: re-parent, re-mint, revoke, idempotent re-run, working session."""
    monkeypatch.setattr(
        settings,
        "agent_gateway_litellm_public_base_url",
        "https://llm.proliferate.ai",
    )
    user_id = await _create_user(db_session)
    org_id = await _place_in_org(db_session, user_id)
    personal = await _pre_d2_personal_enrollment(
        db_session, migration_litellm, user_id, claimed_grant_usd="5", used_usd=2.0
    )
    personal_subject_id = personal.billing_subject_id
    personal_tokens = {
        key.virtual_key_id
        for key in await store.list_active_enrollment_keys(db_session, enrollment_id=personal.id)
    }
    await put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="cloud",
        sources=[DesiredAuthSource(source_kind="gateway")],
    )

    converted = await migrate_legacy_enrollments(db_session)
    assert converted == 1

    # The personal row is retired (disable-not-delete) with its child keys.
    retired = await db_session.get(AgentGatewayEnrollment, personal.id)
    assert retired is not None
    assert retired.revoked_at is not None
    assert await store.list_active_enrollment_keys(db_session, enrollment_id=personal.id) == []
    # Its LiteLLM keys were revoked on the proxy, not just forgotten.
    assert personal_tokens <= set(migration_litellm.deleted_tokens)

    # The org enrollment exists, synced, under the per-(org, member) identity,
    # with one key per gateway-capable harness minted under it.
    org_enrollment = await store.get_enrollment_for_organization(
        db_session, organization_id=org_id, user_id=user_id
    )
    assert org_enrollment is not None
    assert org_enrollment.sync_status == "synced"
    assert org_enrollment.litellm_user_id == f"org-{org_id}-user-{user_id}"
    assert f"org-{org_id}-user-{user_id}" in migration_litellm.users
    org_keys = await store.list_active_enrollment_keys(db_session, enrollment_id=org_enrollment.id)
    assert {key.harness_kind for key in org_keys} == set(_HARNESSES)
    assert all(
        record["user_id"] == f"org-{org_id}-user-{user_id}" for record in migration_litellm.minted
    )

    # Converted-grant accounting: remaining credit moved intact — grant AND
    # spend — never duplicated. The team-budget mirror saw the moved balance.
    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    assert org_enrollment.billing_subject_id == org_subject.id
    org_balance = await store.get_remaining_credit_usd(db_session, org_subject.id)
    assert org_balance.granted_usd == Decimal("5")
    assert org_balance.used_usd == Decimal("2")
    assert org_balance.remaining_usd == Decimal("3")
    personal_balance = await store.get_remaining_credit_usd(db_session, personal_subject_id)
    assert personal_balance.granted_usd == Decimal("0")
    assert personal_balance.used_usd == Decimal("0")
    assert migration_litellm.ensure_team_budgets == [3.0]

    # The resolver (org-only) returns the migrated enrollment...
    resolved = await get_gateway_enrollment_for_user(db_session, user_id)
    assert resolved is not None
    assert resolved.id == org_enrollment.id

    # ...and a session launched after the migration works: the state render
    # (the seam the runtime launches from) hands out the org key.
    state, _ = await build_agent_auth_state(db_session, user_id, surface="cloud")
    rendered = [
        source
        for harness in state["harnesses"]
        for source in harness["sources"]
        if source["kind"] == "gateway"
    ]
    assert len(rendered) == 1
    claude_key = next(key for key in org_keys if key.harness_kind == "claude")
    assert rendered[0]["key"] == await store.get_enrollment_key_virtual_key_decrypted(
        db_session, enrollment_key_id=claude_key.id
    )

    # Idempotent on re-run: nothing to convert, mint, revoke, or grant again.
    minted_before = len(migration_litellm.minted)
    deleted_before = list(migration_litellm.deleted_tokens)
    assert await migrate_legacy_enrollments(db_session) == 0
    assert len(migration_litellm.minted) == minted_before
    assert migration_litellm.deleted_tokens == deleted_before
    again = await store.get_remaining_credit_usd(db_session, org_subject.id)
    assert again.granted_usd == Decimal("5")
    assert again.remaining_usd == Decimal("3")


@pytest.mark.asyncio
async def test_converted_claim_never_double_grants(
    db_session: AsyncSession,
    migration_litellm: _StubLiteLLM,
) -> None:
    """The personal free-credit claim CONVERTS: one grant per human, ever.

    Pre-migration, the claimed allocation on the personal subject blocks the
    org-path grant outright. Post-migration the allocation and the grant both
    belong to the default org's subject, its ``source_ref`` rewritten to the
    org form — so the org-path grant (which re-runs on every enrollment pass)
    converges on the converted row instead of inserting a second one.
    """
    user_id = await _create_user(db_session)
    org_id = await _place_in_org(db_session, user_id)
    await _pre_d2_personal_enrollment(
        db_session, migration_litellm, user_id, claimed_grant_usd="5"
    )

    assert await migrate_legacy_enrollments(db_session) == 1

    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    allocation = (
        await db_session.execute(
            select(FreeCloudAllocation).where(FreeCloudAllocation.user_id == user_id)
        )
    ).scalar_one()
    assert allocation.billing_subject_id == org_subject.id

    # The org-path grant now claims successfully AND grants nothing new.
    assert await ensure_signup_free_credit_grant(db_session, user_id) is True
    grants = (
        (
            await db_session.execute(
                select(LlmCreditGrant).where(
                    LlmCreditGrant.source == LLM_CREDIT_SOURCE_FREE_SIGNUP,
                    LlmCreditGrant.user_id == user_id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(grants) == 1
    assert grants[0].billing_subject_id == org_subject.id
    assert grants[0].source_ref == f"{LLM_CREDIT_SOURCE_FREE_SIGNUP}:{org_subject.id}"
    balance = await store.get_remaining_credit_usd(db_session, org_subject.id)
    assert balance.granted_usd == Decimal("5")


@pytest.mark.asyncio
async def test_migration_defers_user_without_default_org_and_resumes(
    db_session: AsyncSession,
    migration_litellm: _StubLiteLLM,
) -> None:
    """No default org → nothing converted, nothing revoked; resumes later."""
    user_id = await _create_user(db_session)
    personal = await _pre_d2_personal_enrollment(
        db_session, migration_litellm, user_id, claimed_grant_usd=None
    )

    assert await migrate_legacy_enrollments(db_session) == 0
    row = await db_session.get(AgentGatewayEnrollment, personal.id)
    assert row is not None
    assert row.revoked_at is None
    assert migration_litellm.deleted_tokens == []
    active_keys = await store.list_active_enrollment_keys(db_session, enrollment_id=personal.id)
    assert len(active_keys) == len(_HARNESSES)

    # A later tick, after signup placement finally lands, converts it.
    org_id = await _place_in_org(db_session, user_id)
    assert await migrate_legacy_enrollments(db_session) == 1
    row = await db_session.get(AgentGatewayEnrollment, personal.id)
    assert row is not None
    assert row.revoked_at is not None
    org_enrollment = await store.get_enrollment_for_organization(
        db_session, organization_id=org_id, user_id=user_id
    )
    assert org_enrollment is not None
    assert org_enrollment.sync_status == "synced"


@pytest.mark.asyncio
async def test_migration_with_existing_org_enrollment_still_converts_the_ledger(
    db_session: AsyncSession,
    migration_litellm: _StubLiteLLM,
) -> None:
    """A user holding BOTH shapes (pre-D-2 org member + personal residue):
    the ledger still moves, the personal row still retires, and the org row
    is left as the one governing enrollment."""
    user_id = await _create_user(db_session)
    org_id = await _place_in_org(db_session, user_id)
    # Pre-D-2 ordering: the personal claim exists first, so the org
    # enrollment's own free-credit pass found the allocation already claimed
    # (by the personal subject) and granted nothing.
    personal = await _pre_d2_personal_enrollment(
        db_session, migration_litellm, user_id, claimed_grant_usd="5", used_usd=1.0
    )
    existing = await ensure_org_enrollment(db_session, org_id, user_id)
    assert existing.sync_status == "synced"

    assert await migrate_legacy_enrollments(db_session) == 1

    retired = await db_session.get(AgentGatewayEnrollment, personal.id)
    assert retired is not None
    assert retired.revoked_at is not None
    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    balance = await store.get_remaining_credit_usd(db_session, org_subject.id)
    assert balance.granted_usd == Decimal("5")
    assert balance.remaining_usd == Decimal("4")
    resolved = await get_gateway_enrollment_for_user(db_session, user_id)
    assert resolved is not None
    assert resolved.id == existing.id
    # The already-synced org row short-circuits its sync, so the migration
    # itself re-mirrors the LiteLLM team budget from the moved ledger — the
    # stale pre-migration floor must not keep blocking the funded org.
    assert migration_litellm.team_budgets[-1] == (existing.litellm_team_id, 4.0)


@pytest.mark.asyncio
async def test_stale_identity_org_sweep_reminting_via_fingerprint_machinery(
    db_session: AsyncSession,
    migration_litellm: _StubLiteLLM,
) -> None:
    """Pre-D-2 org rows re-mint under `org-<org>-user-<id>` and revoke the old.

    The sweep only feeds the row through ``ensure_org_enrollment``; the sync
    fingerprint machinery (key-set fingerprint covers the LiteLLM identity)
    does the reopen, and the per-key comparison does the revoke + re-mint.
    """
    user_id = await _create_user(db_session, with_github=False)
    org_id = await _place_in_org(db_session, user_id)
    subject = await ensure_organization_billing_subject(db_session, org_id)
    enrollment = await store.ensure_enrollment_row(
        db_session,
        billing_subject_id=subject.id,
        organization_id=org_id,
        user_id=user_id,
    )
    stale_tokens = []
    for harness_kind in _HARNESSES:
        token = f"token-stale-{harness_kind}-{uuid.uuid4().hex[:6]}"
        stale_tokens.append(token)
        migration_litellm.seed_key(
            token, alias=f"vk-org-{org_id}-user-{user_id}-{harness_kind}-{str(enrollment.id)[:8]}"
        )
        await store.upsert_enrollment_key(
            db_session,
            enrollment_id=enrollment.id,
            harness_kind=harness_kind,
            virtual_key_id=token,
            virtual_key=f"sk-litellm-{token}",
            sync_fingerprint="pre-d2-key",
        )
    await store.mark_enrollment_synced(
        db_session,
        enrollment_id=enrollment.id,
        litellm_team_id=f"team-org-{org_id}",
        litellm_user_id=f"user-{user_id}",  # the pre-D-2 shared identity
        virtual_key_id=None,
        virtual_key=None,
        sync_fingerprint="pre-d2-set",
    )

    converted = await migrate_legacy_enrollments(db_session)
    assert converted == 1

    refreshed = await store.get_enrollment_for_organization(
        db_session, organization_id=org_id, user_id=user_id
    )
    assert refreshed is not None
    assert refreshed.sync_status == "synced"
    assert refreshed.litellm_user_id == f"org-{org_id}-user-{user_id}"
    # Every stale key revoked on the proxy; every replacement minted under the
    # per-(org, member) user with its harness's access group.
    assert set(stale_tokens) <= set(migration_litellm.deleted_tokens)
    assert len(migration_litellm.minted) == len(_HARNESSES)
    assert all(
        record["user_id"] == f"org-{org_id}-user-{user_id}" for record in migration_litellm.minted
    )
    keys = await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment.id)
    assert {key.virtual_key_id for key in keys}.isdisjoint(set(stale_tokens))

    # Idempotent: the sweep no longer matches the row, nothing re-mints.
    minted_before = len(migration_litellm.minted)
    assert await migrate_legacy_enrollments(db_session) == 0
    assert len(migration_litellm.minted) == minted_before


# --------------------------------------------------------------------------- #
# Grep gates: the personal-subject path is GONE (D8 + the org-only cut)
# --------------------------------------------------------------------------- #


def _source(module: object) -> str:
    return Path(module.__file__).read_text(encoding="utf-8")  # type: ignore[attr-defined]


class TestOrgOnlyGrepGates:
    def test_personal_enrollment_path_is_gone_from_the_enrollment_service(self) -> None:
        source = _source(enrollment_service)
        assert "ensure_user_enrollment" not in source
        assert "ensure_personal_billing_subject" not in source
        # The shared `user-<uuid>` LiteLLM identity format is not mintable:
        # no f-string in the service builds it.
        assert 'f"user-' not in source

    def test_the_migration_service_cannot_mint_the_legacy_identity_either(self) -> None:
        source = _source(migration_service)
        assert 'f"user-' not in source
        assert "mint_virtual_key" not in source  # it only ever revokes

    def test_resolver_fallback_funding_guard_and_name_order_are_gone(self) -> None:
        """D8 (grep half): default-org resolution only."""
        source = _source(budget_module)
        # The personal-row fallback lookup is gone from the resolver.
        assert "get_enrollment_for_user" not in source
        # The name-ordered org choice never came back.
        assert "get_current_membership_for_user" not in source
        # The per-user default budget (the personal funding source) is gone.
        assert "agent_gateway_default_user_budget_usd" not in source
        assert "AGENT_GATEWAY_SUBJECT_KIND_USER" not in source

    def test_the_store_has_no_personal_insert_or_lookup(self) -> None:
        from proliferate.db.store.agent_gateway import enrollments as enrollments_store

        source = _source(enrollments_store)
        assert "def get_enrollment_for_user" not in source
        # ensure_enrollment_row takes no subject_kind: org is the only shape.
        assert "subject_kind: str" not in source

    def test_the_per_user_default_budget_setting_is_gone_from_config(self) -> None:
        import proliferate.config as config_module

        assert "agent_gateway_default_user_budget_usd" not in _source(config_module)
        assert not hasattr(settings, "agent_gateway_default_user_budget_usd")
