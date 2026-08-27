"""Orphan-allocation reclaim + zero-grant guard tests (real Postgres).

Slice 5's signup-grant fix, proven end to end. Root cause of the founder-org
incident: deleting an account leaves its one-per-GitHub-identity
``free_cloud_allocation`` behind, owned by the deleted account's now-orphaned
org billing subject (org row alive, zero memberships) — so a re-signup on the
same identity hit "claimed elsewhere", the grant silently skipped, and the
SYNCED enrollment was never revisited. Covered here: the reclaim converges
the orphan claim + ledger onto the new default org (and ONLY for an orphan —
a live second account still gets nothing), and ``run_zero_grant_check``
self-heals stale grantless enrollments, alerts on the unhealable, and leaves
in-flight signups alone.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
    LLM_CREDIT_SOURCE_FREE_SIGNUP,
)
from proliferate.constants.billing import (
    FREE_CLOUD_ALLOCATION_KIND_AGENT_GATEWAY_FREE_CREDITS,
)
from proliferate.db.models.auth import AuthIdentity, User
from proliferate.db.models.agent_gateway import AgentGatewayEnrollment, LlmCreditGrant
from proliferate.db.models.billing import FreeCloudAllocation
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject
from proliferate.lib.infra.time.wall_clock import utcnow
from proliferate.server.ai_gateway import free_credits
from proliferate.server.ai_gateway.enrollment import ensure_org_enrollment
from proliferate.server.ai_gateway.free_credits import (
    AgentGatewayZeroGrantEnrollments,
    ensure_signup_free_credit_grant,
    run_zero_grant_check,
)


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"zg-{uuid.uuid4().hex[:10]}@example.com",
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
    organization = Organization(name=f"ZG Org {uuid.uuid4().hex[:6]}")
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


async def _fabricate_orphan_claim(
    db_session: AsyncSession,
    *,
    github_subject: str,
    consumed_usd: float,
) -> uuid.UUID:
    """The deleted first account's residue, exactly as prod forensics found it.

    An org with ZERO memberships (its only member's user row is gone), whose
    billing subject still owns the identity's free-credit allocation and a
    partially consumed free_signup grant. Returns the orphan subject id.
    """
    orphan_org = Organization(name=f"Orphan Org {uuid.uuid4().hex[:6]}")
    db_session.add(orphan_org)
    await db_session.flush()
    orphan_subject = await ensure_organization_billing_subject(db_session, orphan_org.id)
    db_session.add(
        FreeCloudAllocation(
            allocation_kind=FREE_CLOUD_ALLOCATION_KIND_AGENT_GATEWAY_FREE_CREDITS,
            github_provider_user_id=github_subject,
            billing_subject_id=orphan_subject.id,
            # The claiming human's user row was deleted; the allocation column
            # has no FK, so the stale id survives — as it did in prod.
            user_id=uuid.uuid4(),
            period_key=AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
            status="active",
        )
    )
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=orphan_subject.id,
        user_id=None,  # SET NULL on user delete
        source=LLM_CREDIT_SOURCE_FREE_SIGNUP,
        amount_usd=Decimal("5"),
        source_ref=f"{LLM_CREDIT_SOURCE_FREE_SIGNUP}:{orphan_subject.id}",
    )
    await store.insert_usage_event_once(
        db_session,
        litellm_request_id=f"req-orphan-{uuid.uuid4().hex[:8]}",
        occurred_at=datetime(2026, 8, 1, 12, 0, tzinfo=UTC),
        billing_subject_id=orphan_subject.id,
        cost_usd=consumed_usd,
    )
    await db_session.flush()
    return orphan_subject.id


async def _free_signup_grants_for_subjects(
    db_session: AsyncSession, subject_ids: list[uuid.UUID]
) -> list[LlmCreditGrant]:
    return list(
        (
            await db_session.execute(
                select(LlmCreditGrant).where(
                    LlmCreditGrant.source == LLM_CREDIT_SOURCE_FREE_SIGNUP,
                    LlmCreditGrant.billing_subject_id.in_(subject_ids),
                )
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.asyncio
async def test_founder_scenario_reclaims_orphaned_allocation(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A re-signup on a deleted account's identity converges, not starves.

    The allocation claim and the whole ledger (grant AND consumed usage) move
    onto the new default org's subject; the rewritten ``source_ref`` makes the
    follow-up grant converge on the moved grant, so exactly ONE free_signup
    grant exists for the identity and the remaining balance is preserved —
    never re-granted in full, never duplicated.
    """
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    github_subject = f"gh-founder-{uuid.uuid4().hex[:10]}"
    orphan_subject_id = await _fabricate_orphan_claim(
        db_session, github_subject=github_subject, consumed_usd=2.0
    )

    # The founder signs up again on the SAME GitHub identity.
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id, provider_subject=github_subject)
    org_id = await _place_in_org(db_session, user_id=user_id)

    assert await ensure_signup_free_credit_grant(db_session, user_id) is True

    new_subject = await ensure_organization_billing_subject(db_session, org_id)
    allocation = (
        await db_session.execute(
            select(FreeCloudAllocation).where(
                FreeCloudAllocation.allocation_kind
                == FREE_CLOUD_ALLOCATION_KIND_AGENT_GATEWAY_FREE_CREDITS,
                FreeCloudAllocation.github_provider_user_id == github_subject,
            )
        )
    ).scalar_one()
    assert allocation.billing_subject_id == new_subject.id

    grants = await _free_signup_grants_for_subjects(
        db_session, [orphan_subject_id, new_subject.id]
    )
    assert len(grants) == 1  # converged, never duplicated
    assert grants[0].billing_subject_id == new_subject.id
    assert grants[0].source_ref == f"{LLM_CREDIT_SOURCE_FREE_SIGNUP}:{new_subject.id}"

    # The ledger moved whole: the $2 already consumed rides along.
    balance = await store.get_remaining_credit_usd(db_session, new_subject.id)
    assert balance.granted_usd == Decimal("5")
    assert balance.used_usd == Decimal("2")
    assert balance.remaining_usd == Decimal("3")
    orphan_balance = await store.get_remaining_credit_usd(db_session, orphan_subject_id)
    assert orphan_balance.granted_usd == Decimal("0")
    assert orphan_balance.used_usd == Decimal("0")

    # Idempotent: a second pass converges on the same single grant.
    assert await ensure_signup_free_credit_grant(db_session, user_id) is True
    grants = await _free_signup_grants_for_subjects(
        db_session, [orphan_subject_id, new_subject.id]
    )
    assert len(grants) == 1


@pytest.mark.asyncio
async def test_reclaim_does_not_fire_when_claiming_org_is_live(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A live second account on the same identity still gets nothing.

    The claiming org has an active membership, so it is NOT an orphan — the
    anti-abuse dedupe is behaving correctly and the reclaim must leave the
    claim, the grant, and the ledger exactly where they are.
    """
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    first_user = await _create_user(db_session)
    github_subject = await _link_github_identity(db_session, user_id=first_user)
    first_org = await _place_in_org(db_session, user_id=first_user)
    assert await ensure_signup_free_credit_grant(db_session, first_user) is True

    # The human re-links the identity to a fresh account (first account and
    # its org membership stay alive).
    second_user = await _create_user(db_session)
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

    first_subject = await ensure_organization_billing_subject(db_session, first_org)
    second_subject = await ensure_organization_billing_subject(db_session, second_org)
    allocation = (
        await db_session.execute(
            select(FreeCloudAllocation).where(
                FreeCloudAllocation.allocation_kind
                == FREE_CLOUD_ALLOCATION_KIND_AGENT_GATEWAY_FREE_CREDITS,
                FreeCloudAllocation.github_provider_user_id == github_subject,
            )
        )
    ).scalar_one()
    assert allocation.billing_subject_id == first_subject.id  # claim untouched
    first_balance = await store.get_remaining_credit_usd(db_session, first_subject.id)
    assert first_balance.granted_usd == Decimal("5")
    second_balance = await store.get_remaining_credit_usd(db_session, second_subject.id)
    assert second_balance.granted_usd == Decimal("0")


def _capture_report_critical(
    monkeypatch: pytest.MonkeyPatch,
) -> list[tuple[Exception, dict[str, Any]]]:
    calls: list[tuple[Exception, dict[str, Any]]] = []

    def _capture(error: Exception, **kwargs: Any) -> None:
        calls.append((error, kwargs))

    monkeypatch.setattr(free_credits, "report_critical", _capture)
    return calls


async def _backdate_enrollment(
    db_session: AsyncSession, enrollment_id: uuid.UUID, *, hours: int
) -> None:
    await db_session.execute(
        update(AgentGatewayEnrollment)
        .where(AgentGatewayEnrollment.id == enrollment_id)
        .values(created_at=utcnow() - timedelta(hours=hours))
    )


@pytest.mark.asyncio
async def test_zero_grant_check_heals_stale_grantless_enrollment(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The self-heal: an aged grantless enrollment gets its grant re-attempted.

    The enrollment row exists with no grant (the founder shape: created while
    the grant path silently skipped — reproduced here by enrolling with the
    gateway disabled, which writes the row and nothing else). One guard pass
    lands the grant.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    calls = _capture_report_critical(monkeypatch)
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    org_id = await _place_in_org(db_session, user_id=user_id)
    enrollment = await ensure_org_enrollment(db_session, org_id, user_id)
    await _backdate_enrollment(db_session, enrollment.id, hours=2)

    result = await run_zero_grant_check(db_session)

    assert result.checked == 1
    assert result.healed == 1
    assert result.alerted == 0
    assert result.healed_organization_ids == (org_id,)
    assert calls == []
    balance = await store.get_remaining_credit_usd(db_session, enrollment.billing_subject_id)
    assert balance.granted_usd == Decimal("5")


@pytest.mark.asyncio
async def test_zero_grant_check_alerts_when_grant_cannot_land(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Still grantless after the heal attempt → one ops alert for the tick.

    No linked GitHub identity means the grant has nothing to dedupe on and
    can never land; the guard must say so loudly instead of sweeping forever.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    calls = _capture_report_critical(monkeypatch)
    user_id = await _create_user(db_session)  # deliberately no GitHub identity
    org_id = await _place_in_org(db_session, user_id=user_id)
    enrollment = await ensure_org_enrollment(db_session, org_id, user_id)
    await _backdate_enrollment(db_session, enrollment.id, hours=2)

    result = await run_zero_grant_check(db_session)

    assert result.checked == 1
    assert result.healed == 0
    assert result.alerted == 1
    assert result.alerted_organization_ids == (org_id,)
    assert len(calls) == 1  # ONE alert per tick
    error, kwargs = calls[0]
    assert isinstance(error, AgentGatewayZeroGrantEnrollments)
    assert kwargs["tags"] == {"domain": "agent_gateway", "action": "zero_grant_check"}
    assert kwargs["extras"]["zero_grant_count"] == 1
    assert kwargs["extras"]["zero_grant_organization_ids"] == [str(org_id)]


@pytest.mark.asyncio
async def test_zero_grant_check_ignores_enrollments_younger_than_cutoff(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An in-flight signup is not a finding: young rows stay out of the sweep."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    calls = _capture_report_critical(monkeypatch)
    user_id = await _create_user(db_session)
    org_id = await _place_in_org(db_session, user_id=user_id)
    enrollment = await ensure_org_enrollment(db_session, org_id, user_id)
    assert enrollment.id is not None  # fresh row, created_at = now

    result = await run_zero_grant_check(db_session)

    assert result.checked == 0
    assert result.healed == 0
    assert result.alerted == 0
    assert calls == []
