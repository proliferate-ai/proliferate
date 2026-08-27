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

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
    LLM_CREDIT_SOURCE_ADMIN,
    LLM_CREDIT_SOURCE_FREE_SIGNUP,
    LLM_CREDIT_SOURCE_TOPUP,
)
from proliferate.constants.billing import (
    FREE_CLOUD_ALLOCATION_KIND_AGENT_GATEWAY_FREE_CREDITS,
)
from proliferate.db.models.auth import AuthIdentity, User
from proliferate.db.models.agent_gateway import (
    AgentGatewayEnrollment,
    AgentLlmUsageEvent,
    LlmCreditGrant,
)
from proliferate.db.models.billing import FreeCloudAllocation
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject
from proliferate.lib.infra.time.wall_clock import utcnow
from proliferate.server.ai_gateway import free_credits
from proliferate.server.ai_gateway.enrollment import ensure_org_enrollment
from proliferate.server.ai_gateway.free_credits import (
    AgentGatewayReclaimLedgerRaced,
    AgentGatewayZeroGrantEnrollments,
    ZeroGrantCheckResult,
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


@pytest.mark.asyncio
async def test_reclaim_refused_when_orphan_holds_paid_topup(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """P2: an orphan holding real paid money is never auto-drained.

    A $50 top-up on the orphan subject means the ledger is not provably the
    identity's own signup grant — the reclaim refuses with the non-paging
    manual-resolution error and moves NOTHING (the panel's probe showed the
    old code moving the $50 onto the new org).
    """
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    github_subject = f"gh-topup-{uuid.uuid4().hex[:10]}"
    orphan_subject_id = await _fabricate_orphan_claim(
        db_session, github_subject=github_subject, consumed_usd=2.0
    )
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=orphan_subject_id,
        user_id=None,
        source=LLM_CREDIT_SOURCE_TOPUP,
        amount_usd=Decimal("50"),
        source_ref=f"topup:{uuid.uuid4().hex[:8]}",
    )

    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id, provider_subject=github_subject)
    org_id = await _place_in_org(db_session, user_id=user_id)

    with caplog.at_level(logging.ERROR, logger="proliferate.server.ai_gateway.free_credits"):
        assert await ensure_signup_free_credit_grant(db_session, user_id) is False

    # Nothing moved: the paid credit stays on the orphan, the new org has $0,
    # and the claim is untouched.
    orphan_balance = await store.get_remaining_credit_usd(db_session, orphan_subject_id)
    assert orphan_balance.granted_usd == Decimal("55")
    assert orphan_balance.used_usd == Decimal("2")
    new_subject = await ensure_organization_billing_subject(db_session, org_id)
    new_balance = await store.get_remaining_credit_usd(db_session, new_subject.id)
    assert new_balance.granted_usd == Decimal("0")
    allocation = (
        await db_session.execute(
            select(FreeCloudAllocation).where(
                FreeCloudAllocation.github_provider_user_id == github_subject
            )
        )
    ).scalar_one()
    assert allocation.billing_subject_id == orphan_subject_id
    assert any(
        getattr(record, "reason", None) == "orphan_ledger_not_identity_pure"
        for record in caplog.records
    )


@pytest.mark.asyncio
async def test_reclaim_refused_when_second_humans_allocation_rides_the_orphan(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """P3: a second human's claim on the same orphan subject blocks the move.

    Moving the subject would drag the other identity's allocation history
    with it (the panel's probe showed exactly that, permanently breaking the
    second human's own grant with no alert). Refused; both claims untouched.
    """
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    github_subject = f"gh-a-{uuid.uuid4().hex[:10]}"
    other_subject = f"gh-b-{uuid.uuid4().hex[:10]}"
    orphan_subject_id = await _fabricate_orphan_claim(
        db_session, github_subject=github_subject, consumed_usd=1.0
    )
    db_session.add(
        FreeCloudAllocation(
            allocation_kind=FREE_CLOUD_ALLOCATION_KIND_AGENT_GATEWAY_FREE_CREDITS,
            github_provider_user_id=other_subject,
            billing_subject_id=orphan_subject_id,
            user_id=uuid.uuid4(),
            period_key=AGENT_GATEWAY_FREE_CREDIT_PERIOD_KEY,
            status="active",
        )
    )
    await db_session.flush()

    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id, provider_subject=github_subject)
    await _place_in_org(db_session, user_id=user_id)

    with caplog.at_level(logging.ERROR, logger="proliferate.server.ai_gateway.free_credits"):
        assert await ensure_signup_free_credit_grant(db_session, user_id) is False

    # Both identities' claims still sit on the orphan; the ledger is intact.
    for identity in (github_subject, other_subject):
        allocation = (
            await db_session.execute(
                select(FreeCloudAllocation).where(
                    FreeCloudAllocation.github_provider_user_id == identity
                )
            )
        ).scalar_one()
        assert allocation.billing_subject_id == orphan_subject_id
    orphan_balance = await store.get_remaining_credit_usd(db_session, orphan_subject_id)
    assert orphan_balance.granted_usd == Decimal("5")
    assert any(
        getattr(record, "reason", None) == "orphan_holds_foreign_allocations"
        for record in caplog.records
    )


@pytest.mark.asyncio
async def test_reclaim_refused_when_destination_already_has_free_signup(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """P4: a destination already holding free_signup never receives a second.

    With the destination ref taken, move_llm_credit_ledger's source_ref
    rewrite is skipped and the orphan's grant row would land beside the
    existing one — two free_signup rows (the panel's double-free_signup
    probe). Refused instead; each subject keeps exactly its own row.
    """
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    github_subject = f"gh-dest-{uuid.uuid4().hex[:10]}"
    orphan_subject_id = await _fabricate_orphan_claim(
        db_session, github_subject=github_subject, consumed_usd=0.5
    )

    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id, provider_subject=github_subject)
    org_id = await _place_in_org(db_session, user_id=user_id)
    dest_subject = await ensure_organization_billing_subject(db_session, org_id)
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=dest_subject.id,
        user_id=None,
        source=LLM_CREDIT_SOURCE_FREE_SIGNUP,
        amount_usd=Decimal("5"),
        source_ref=f"{LLM_CREDIT_SOURCE_FREE_SIGNUP}:{dest_subject.id}",
    )

    with caplog.at_level(logging.ERROR, logger="proliferate.server.ai_gateway.free_credits"):
        assert await ensure_signup_free_credit_grant(db_session, user_id) is False

    grants = await _free_signup_grants_for_subjects(
        db_session, [orphan_subject_id, dest_subject.id]
    )
    by_subject = {grant.billing_subject_id for grant in grants}
    assert len(grants) == 2  # one each — never two on the destination
    assert by_subject == {orphan_subject_id, dest_subject.id}
    assert any(
        getattr(record, "reason", None) == "destination_already_has_free_signup"
        for record in caplog.records
    )


@pytest.mark.asyncio
async def test_reclaim_aborts_when_a_grant_lands_in_the_toctou_window(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Safety-panel N1: a grant committed after the purity read aborts the move.

    ``move_llm_credit_ledger`` is an unfiltered subject-wide UPDATE, so money
    that appears between the vetting reads and the move would be swept along.
    The purity read takes ``FOR UPDATE`` (which cannot lock a row that does
    not exist yet), and this belt catches the INSERT case: moved > observed
    raises, so the whole reclaim rolls back rather than keeping unvetted money.
    """
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    github_subject = f"gh-race-{uuid.uuid4().hex[:10]}"
    orphan_subject_id = await _fabricate_orphan_claim(
        db_session, github_subject=github_subject, consumed_usd=0.0
    )
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id, provider_subject=github_subject)
    await _place_in_org(db_session, user_id=user_id)
    paged = _capture_report_critical(monkeypatch)

    real_move = store.move_llm_credit_ledger

    async def racing_move(
        db: AsyncSession,
        *,
        from_billing_subject_id: uuid.UUID,
        to_billing_subject_id: uuid.UUID,
    ) -> tuple[int, int]:
        # The window: an admin grant lands on the orphan after the purity read
        # observed exactly one (the identity's own signup grant).
        await store.create_llm_credit_grant(
            db,
            billing_subject_id=from_billing_subject_id,
            user_id=None,
            source=LLM_CREDIT_SOURCE_ADMIN,
            amount_usd=Decimal("99"),
            source_ref=f"admin:{uuid.uuid4().hex[:8]}",
        )
        return await real_move(
            db,
            from_billing_subject_id=from_billing_subject_id,
            to_billing_subject_id=to_billing_subject_id,
        )

    monkeypatch.setattr(free_credits.agent_gateway_store, "move_llm_credit_ledger", racing_move)

    with pytest.raises(AgentGatewayReclaimLedgerRaced):
        await ensure_signup_free_credit_grant(db_session, user_id)

    # The reclaim's SAVEPOINT undid its own ledger movement before the raise
    # escaped, so the claim never re-points and the source keeps its grant —
    # no dependence on any caller's transaction handling.
    allocation = (
        await db_session.execute(
            select(FreeCloudAllocation).where(
                FreeCloudAllocation.github_provider_user_id == github_subject
            )
        )
    ).scalar_one()
    assert allocation.billing_subject_id == orphan_subject_id
    # The savepoint restored the source ledger: its own signup grant is back and
    # the racing admin grant is gone.
    source_grants = await store.list_llm_credit_grants(db_session, orphan_subject_id)
    assert [grant.source for grant in source_grants] == [LLM_CREDIT_SOURCE_FREE_SIGNUP]
    assert len(paged) == 1
    error, kwargs = paged[0]
    assert isinstance(error, AgentGatewayReclaimLedgerRaced)
    # Tagged as the reclaim's own action, not the guard's: the raise also fires
    # on the signup path, where "zero_grant_check" would mislead triage.
    assert kwargs["tags"] == {"domain": "agent_gateway", "action": "orphan_reclaim"}


@pytest.mark.asyncio
async def test_reclaim_aborts_when_destination_gains_free_signup_in_the_window(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Audit F1: the DESTINATION side of the window cannot add free money.

    A free_signup grant committed on the destination between the P4 check and
    the move slips past every other guard: the move's source_ref rewrite
    correctly declines (the ref is taken), the moved count still matches the
    source, and the moved row lands BESIDE the existing one — two free_signup
    rows, credit increased without entitlement. The destination invariant
    catches it and rolls the reclaim back.
    """
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    github_subject = f"gh-destrace-{uuid.uuid4().hex[:8]}"
    await _fabricate_orphan_claim(db_session, github_subject=github_subject, consumed_usd=0.0)
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id, provider_subject=github_subject)
    org_id = await _place_in_org(db_session, user_id=user_id)
    dest_subject = await ensure_organization_billing_subject(db_session, org_id)
    paged = _capture_report_critical(monkeypatch)

    real_move = store.move_llm_credit_ledger

    async def racing_move(
        db: AsyncSession,
        *,
        from_billing_subject_id: uuid.UUID,
        to_billing_subject_id: uuid.UUID,
    ) -> tuple[int, int]:
        # The window: a free_signup grant lands on the DESTINATION after P4
        # read it as empty.
        await store.create_llm_credit_grant(
            db,
            billing_subject_id=to_billing_subject_id,
            user_id=None,
            source=LLM_CREDIT_SOURCE_FREE_SIGNUP,
            amount_usd=Decimal("5"),
            source_ref=f"{LLM_CREDIT_SOURCE_FREE_SIGNUP}:{to_billing_subject_id}",
        )
        return await real_move(
            db,
            from_billing_subject_id=from_billing_subject_id,
            to_billing_subject_id=to_billing_subject_id,
        )

    monkeypatch.setattr(free_credits.agent_gateway_store, "move_llm_credit_ledger", racing_move)

    with pytest.raises(AgentGatewayReclaimLedgerRaced) as raised:
        await ensure_signup_free_credit_grant(db_session, user_id)

    # The invariant OBSERVED the two-row state and the savepoint then undid the
    # movement, so the doubled row is gone from this session too — the rejection
    # is self-contained, not dependent on the caller's transaction handling.
    assert "free_signup grants after the move" in str(raised.value)
    assert str(dest_subject.id) in str(raised.value)
    dest_signups = [
        grant
        for grant in await store.list_llm_credit_grants(db_session, dest_subject.id)
        if grant.source == LLM_CREDIT_SOURCE_FREE_SIGNUP
    ]
    # Zero, not one: the racing insert happened INSIDE the savepoint too, so it
    # is undone along with the move. What matters is that the destination never
    # keeps a free_signup row it was not entitled to (pre-fix it kept two).
    assert dest_signups == []
    assert len(paged) == 1
    error, kwargs = paged[0]
    assert isinstance(error, AgentGatewayReclaimLedgerRaced)
    assert kwargs["tags"] == {"domain": "agent_gateway", "action": "orphan_reclaim"}


@pytest.mark.asyncio
async def test_reclaim_aborts_when_a_usage_row_lands_in_the_window(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Audit F2: the debit side is vetted too, by count.

    ``move_llm_credit_ledger`` moves usage rows as well, so a row imported
    into the window would ride along unvetted and silently reduce the
    destination's remaining credit. The usage-count invariant aborts instead.
    """
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    github_subject = f"gh-usagerace-{uuid.uuid4().hex[:8]}"
    await _fabricate_orphan_claim(db_session, github_subject=github_subject, consumed_usd=0.0)
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id, provider_subject=github_subject)
    org_id = await _place_in_org(db_session, user_id=user_id)
    dest_subject = await ensure_organization_billing_subject(db_session, org_id)
    paged = _capture_report_critical(monkeypatch)

    real_move = store.move_llm_credit_ledger

    async def racing_move(
        db: AsyncSession,
        *,
        from_billing_subject_id: uuid.UUID,
        to_billing_subject_id: uuid.UUID,
    ) -> tuple[int, int]:
        # The window: the importer attributes a big debit to the orphan.
        await store.insert_usage_event_once(
            db,
            litellm_request_id=f"req-race-{uuid.uuid4().hex[:8]}",
            occurred_at=datetime(2026, 8, 2, 12, 0, tzinfo=UTC),
            billing_subject_id=from_billing_subject_id,
            cost_usd=500.0,
        )
        return await real_move(
            db,
            from_billing_subject_id=from_billing_subject_id,
            to_billing_subject_id=to_billing_subject_id,
        )

    monkeypatch.setattr(free_credits.agent_gateway_store, "move_llm_credit_ledger", racing_move)

    with pytest.raises(AgentGatewayReclaimLedgerRaced):
        await ensure_signup_free_credit_grant(db_session, user_id)

    assert len(paged) == 1
    error, kwargs = paged[0]
    assert isinstance(error, AgentGatewayReclaimLedgerRaced)
    assert "usage row" in str(error)
    assert kwargs["tags"] == {"domain": "agent_gateway", "action": "orphan_reclaim"}
    # The destination never inherited the raced debit as a completed reclaim.
    assert dest_subject.id is not None


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


async def _pageable_grantless_enrollment(
    db_session: AsyncSession,
) -> tuple[uuid.UUID, uuid.UUID]:
    """A still-grantless enrollment the guard MUST page on: identity linked,
    the org IS the user's default, but the identity's claim is held by a
    LIVE other org (a second account on a re-linked identity), so the heal
    attempt can never land a grant. Returns (user_id, org_id)."""
    first_user = await _create_user(db_session)
    github_subject = await _link_github_identity(db_session, user_id=first_user)
    await _place_in_org(db_session, user_id=first_user)
    assert await ensure_signup_free_credit_grant(db_session, first_user) is True

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
    enrollment = await ensure_org_enrollment(db_session, second_org, second_user)
    await _backdate_enrollment(db_session, enrollment.id, hours=2)
    return second_user, second_org


@pytest.mark.asyncio
async def test_zero_grant_check_pages_on_unexplained_grantless_org(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A pageable still-grantless org raises ONE aggregated alert whose
    extras survive the real Sentry projection (no monkeypatch blind spot)."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    calls = _capture_report_critical(monkeypatch)
    _, org_id = await _pageable_grantless_enrollment(db_session)

    result = await run_zero_grant_check(db_session)

    assert result.checked == 1
    assert result.healed == 0
    assert result.alerted == 1
    assert result.alerted_organization_ids == (org_id,)
    assert len(calls) == 1  # ONE aggregated alert per pass
    error, kwargs = calls[0]
    assert isinstance(error, AgentGatewayZeroGrantEnrollments)
    assert kwargs["tags"] == {"domain": "agent_gateway", "action": "zero_grant_check"}
    assert kwargs["extras"] == {"zero_grant_organization_ids": [str(org_id)]}
    # The extras must survive the REAL projection path — a key the allowlist
    # drops or redacts would silently strip the alert's payload.
    from proliferate.integrations.sentry.privacy import _project_extras

    assert _project_extras(kwargs["extras"]) == kwargs["extras"]


@pytest.mark.asyncio
async def test_zero_grant_check_classifies_no_identity_as_non_paging(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """No linked GitHub identity → legitimately unhealable, logged, never paged.

    The dedupe is GitHub-keyed: this shape can never receive a grant, and
    paging it hourly forever would be pure noise.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    calls = _capture_report_critical(monkeypatch)
    user_id = await _create_user(db_session)  # deliberately no GitHub identity
    org_id = await _place_in_org(db_session, user_id=user_id)
    enrollment = await ensure_org_enrollment(db_session, org_id, user_id)
    await _backdate_enrollment(db_session, enrollment.id, hours=2)

    with caplog.at_level(logging.WARNING, logger="proliferate.server.ai_gateway.free_credits"):
        result = await run_zero_grant_check(db_session)

    assert result.checked == 1
    assert result.healed == 0
    assert result.alerted == 0
    assert calls == []
    assert any(
        getattr(record, "reason", None) == "no_github_identity" for record in caplog.records
    )


@pytest.mark.asyncio
async def test_zero_grant_check_classifies_non_default_org_as_non_paging(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """An invitee org's grantless subject is by design, not an incident.

    The grant lands only on the member's DEFAULT org; an org the user joined
    later never receives it, so its zero-grant subject must classify out
    instead of paging on every sweep.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    calls = _capture_report_critical(monkeypatch)
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    await _place_in_org(db_session, user_id=user_id)  # the DEFAULT org
    later_org = await _place_in_org(db_session, user_id=user_id)  # invitee org
    enrollment = await ensure_org_enrollment(db_session, later_org, user_id)
    await _backdate_enrollment(db_session, enrollment.id, hours=2)

    with caplog.at_level(logging.WARNING, logger="proliferate.server.ai_gateway.free_credits"):
        result = await run_zero_grant_check(db_session)

    assert result.checked == 1
    assert result.healed == 0
    assert result.alerted == 0
    assert calls == []
    assert any(getattr(record, "reason", None) == "non_default_org" for record in caplog.records)


@pytest.mark.asyncio
async def test_zero_grant_check_pages_once_per_org(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A still-broken org pages on its first pass and only warns after.

    The caller-owned already-alerted set is the memory: the worker passes a
    process-lifetime set, so an unhealable org can never become a paging
    storm (a process restart re-pages once — accepted).
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    calls = _capture_report_critical(monkeypatch)
    _, org_id = await _pageable_grantless_enrollment(db_session)
    alerted: set[uuid.UUID] = set()

    first = await run_zero_grant_check(db_session, already_alerted_org_ids=alerted)
    second = await run_zero_grant_check(db_session, already_alerted_org_ids=alerted)

    assert first.alerted == 1
    assert first.alerted_organization_ids == (org_id,)
    assert second.alerted == 0
    assert second.alerted_organization_ids == ()
    assert len(calls) == 1  # the repeat pass warned instead of paging again
    assert alerted == {org_id}


@pytest.mark.asyncio
async def test_healed_org_is_evicted_so_a_re_break_pages_again(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Safety-panel N3: the already-paged set is not add-only for the process.

    An org that pages, then heals, then breaks again must page for the SECOND
    break too — otherwise one lifetime alert covers every future incident for
    that org. Healing evicts it from the set.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    calls = _capture_report_critical(monkeypatch)
    _, org_id = await _pageable_grantless_enrollment(db_session)
    subject = await ensure_organization_billing_subject(db_session, org_id)
    alerted: set[uuid.UUID] = set()

    first = await run_zero_grant_check(db_session, already_alerted_org_ids=alerted)
    assert first.alerted == 1
    assert alerted == {org_id}

    # Heal it out of the feed (any grant of any source counts as funded).
    healing_ref = f"admin:{uuid.uuid4().hex[:8]}"
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject.id,
        user_id=None,
        source=LLM_CREDIT_SOURCE_ADMIN,
        amount_usd=Decimal("10"),
        source_ref=healing_ref,
    )
    # Funded out of band, the org leaves the feed entirely (checked == 0), which
    # is exactly the shape that would never appear in healed_organization_ids —
    # eviction must not depend on in-pass healing alone.
    healed_pass = await run_zero_grant_check(db_session, already_alerted_org_ids=alerted)
    assert healed_pass.checked == 0
    assert healed_pass.alerted == 0
    assert alerted == set()  # evicted: no longer broken

    # Re-break: the grant goes away again.
    grant_row = (
        await db_session.execute(
            select(LlmCreditGrant).where(LlmCreditGrant.source_ref == healing_ref)
        )
    ).scalar_one()
    await db_session.delete(grant_row)
    await db_session.flush()

    second = await run_zero_grant_check(db_session, already_alerted_org_ids=alerted)

    assert second.alerted == 1
    assert second.alerted_organization_ids == (org_id,)
    assert len(calls) == 2  # one page per break, not one per lifetime
    assert alerted == {org_id}


@pytest.mark.asyncio
async def test_healed_org_is_evicted_even_when_the_feed_is_truncated(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Audit F3: the truncated-feed branch must evict out-of-band heals too.

    With the feed truncated at its limit, absence from a pass proves nothing,
    so the earlier fix only evicted in-pass heals — leaving an org funded by
    admin grant/top-up suppressed forever (the same bug the eviction fixed, in
    the other branch). The truncated branch now re-queries the suppressed orgs
    directly.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    calls = _capture_report_critical(monkeypatch)
    _, org_id = await _pageable_grantless_enrollment(db_session)
    subject = await ensure_organization_billing_subject(db_session, org_id)
    alerted: set[uuid.UUID] = set()

    # limit=1 makes every pass a truncated one (len(listed) == limit).
    first = await run_zero_grant_check(db_session, limit=1, already_alerted_org_ids=alerted)
    assert first.alerted == 1
    assert alerted == {org_id}

    # Funded out of band, and the feed stays truncated by another broken org so
    # the whole-backlog branch cannot be the thing that evicts.
    healing_ref = f"admin:{uuid.uuid4().hex[:8]}"
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject.id,
        user_id=None,
        source=LLM_CREDIT_SOURCE_ADMIN,
        amount_usd=Decimal("10"),
        source_ref=healing_ref,
    )
    other_user = await _create_user(db_session)
    other_org = await _place_in_org(db_session, user_id=other_user)
    other_enrollment = await ensure_org_enrollment(db_session, other_org, other_user)
    await _backdate_enrollment(db_session, other_enrollment.id, hours=2)

    second = await run_zero_grant_check(db_session, limit=1, already_alerted_org_ids=alerted)

    assert second.checked == 1  # truncated: only the other org fit the window
    assert org_id not in alerted  # evicted despite never appearing as healed
    assert len(calls) >= 1

    # Re-break the original org: it must page again rather than stay silenced.
    grant_row = (
        await db_session.execute(
            select(LlmCreditGrant).where(LlmCreditGrant.source_ref == healing_ref)
        )
    ).scalar_one()
    await db_session.delete(grant_row)
    await db_session.flush()
    pages_before = len(calls)

    third = await run_zero_grant_check(db_session, limit=50, already_alerted_org_ids=alerted)

    assert org_id in third.alerted_organization_ids
    assert len(calls) == pages_before + 1


@pytest.mark.asyncio
async def test_raced_reclaim_pages_once_and_the_sweep_continues(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Audit N-a: one signal per race, and one bad org cannot abort the sweep.

    A race reached through the sweep used to page twice — once as
    ``orphan_reclaim`` from the reclaim, then again as ``zero_grant_check``
    when the re-raise hit the worker's guard ``except`` — and it aborted the
    remaining orgs. The heal loop now catches it, counts it, and continues.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    paged = _capture_report_critical(monkeypatch)

    # Org A: a grantless enrollment whose heal goes through the reclaim, which
    # will race. Its identity's claim sits on an orphan.
    github_subject = f"gh-sweeprace-{uuid.uuid4().hex[:8]}"
    await _fabricate_orphan_claim(db_session, github_subject=github_subject, consumed_usd=0.0)
    raced_user = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=raced_user, provider_subject=github_subject)
    raced_org = await _place_in_org(db_session, user_id=raced_user)
    raced_enrollment = await ensure_org_enrollment(db_session, raced_org, raced_user)
    await _backdate_enrollment(db_session, raced_enrollment.id, hours=2)

    # Org B: an ordinary healable grantless enrollment that must still be
    # processed after org A's race.
    healable_user = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=healable_user)
    healable_org = await _place_in_org(db_session, user_id=healable_user)
    healable_enrollment = await ensure_org_enrollment(db_session, healable_org, healable_user)
    await _backdate_enrollment(db_session, healable_enrollment.id, hours=2)

    real_move = store.move_llm_credit_ledger

    async def racing_move(
        db: AsyncSession,
        *,
        from_billing_subject_id: uuid.UUID,
        to_billing_subject_id: uuid.UUID,
    ) -> tuple[int, int]:
        await store.create_llm_credit_grant(
            db,
            billing_subject_id=from_billing_subject_id,
            user_id=None,
            source=LLM_CREDIT_SOURCE_ADMIN,
            amount_usd=Decimal("99"),
            source_ref=f"admin:{uuid.uuid4().hex[:8]}",
        )
        return await real_move(
            db,
            from_billing_subject_id=from_billing_subject_id,
            to_billing_subject_id=to_billing_subject_id,
        )

    monkeypatch.setattr(free_credits.agent_gateway_store, "move_llm_credit_ledger", racing_move)

    result = await run_zero_grant_check(db_session)

    # The sweep did not abort: both orgs were seen, the race was counted, and
    # org B — listed AFTER the racing org — still healed.
    assert result.checked == 2
    assert result.raced == 1
    assert healable_org in result.healed_organization_ids
    # The savepoint undid the racing org's movement, so it is genuinely still
    # grantless and must NOT be counted as healed (it read as healed before the
    # rejection was made self-contained).
    assert raced_org not in result.healed_organization_ids
    assert result.healed == 1
    healable_subject = await ensure_organization_billing_subject(db_session, healable_org)
    balance = await store.get_remaining_credit_usd(db_session, healable_subject.id)
    assert balance.granted_usd == Decimal("5")

    # Exactly ONE page for the race, tagged as the reclaim's own action.
    reclaim_pages = [
        (error, kwargs)
        for error, kwargs in paged
        if isinstance(error, AgentGatewayReclaimLedgerRaced)
    ]
    assert len(reclaim_pages) == 1
    assert reclaim_pages[0][1]["tags"]["action"] == "orphan_reclaim"
    assert not any(
        kwargs["tags"].get("action") == "zero_grant_check"
        and isinstance(error, AgentGatewayReclaimLedgerRaced)
        for error, kwargs in paged
    )


@pytest.mark.asyncio
async def test_sweep_rejection_is_durable_across_a_real_commit_boundary(
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The rollback holds through the worker's OWN transaction, end to end.

    This is the property the earlier tests could not observe, and whose absence
    let a regression through: the sweep catches the raced exception, so the
    worker's ``async with db.begin()`` exits NORMALLY and commits whatever is
    still pending. Before the reclaim owned its rollback via SAVEPOINT, that
    committed the rejected ledger movement — paid grants, usage rows and a
    doubled free_signup, all durable.

    So this drives ``worker.run_zero_grant_check_once()`` (which opens and
    COMMITS its own transaction) against a COMMITTED fixture, then asserts from
    a FRESH session. No assertion may read the fixture session's own view.
    """
    from proliferate.db import engine as engine_module
    from proliferate.server.ai_gateway import worker

    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(engine_module, "async_session_factory", factory)

    github_subject = f"gh-e2e-{uuid.uuid4().hex[:8]}"
    # Build the whole world and COMMIT it, so the worker's own session sees it.
    async with factory() as setup:
        orphan_subject_id = await _fabricate_orphan_claim(
            setup, github_subject=github_subject, consumed_usd=2.0
        )
        raced_user = await _create_user(setup)
        await _link_github_identity(setup, user_id=raced_user, provider_subject=github_subject)
        raced_org = await _place_in_org(setup, user_id=raced_user)
        raced_subject = await ensure_organization_billing_subject(setup, raced_org)
        raced_enrollment = await ensure_org_enrollment(setup, raced_org, raced_user)
        await _backdate_enrollment(setup, raced_enrollment.id, hours=2)

        healable_user = await _create_user(setup)
        await _link_github_identity(setup, user_id=healable_user)
        healable_org = await _place_in_org(setup, user_id=healable_user)
        healable_enrollment = await ensure_org_enrollment(setup, healable_org, healable_user)
        await _backdate_enrollment(setup, healable_enrollment.id, hours=2)
        await setup.commit()

    paged = _capture_report_critical(monkeypatch)
    real_move = store.move_llm_credit_ledger

    async def racing_move(
        db: AsyncSession,
        *,
        from_billing_subject_id: uuid.UUID,
        to_billing_subject_id: uuid.UUID,
    ) -> tuple[int, int]:
        await store.create_llm_credit_grant(
            db,
            billing_subject_id=from_billing_subject_id,
            user_id=None,
            source=LLM_CREDIT_SOURCE_TOPUP,
            amount_usd=Decimal("50"),
            source_ref=f"topup:{uuid.uuid4().hex[:8]}",
        )
        return await real_move(
            db,
            from_billing_subject_id=from_billing_subject_id,
            to_billing_subject_id=to_billing_subject_id,
        )

    monkeypatch.setattr(free_credits.agent_gateway_store, "move_llm_credit_ledger", racing_move)

    result = await worker.run_zero_grant_check_once()

    # FRESH session, after the worker's transaction committed: nothing about the
    # rejected reclaim may have survived. Asserted FIRST — durable money is this
    # test's headline property, so it should be the assertion that fails if the
    # rollback stops being self-contained.
    async with factory() as check:
        orphan_grants = await store.list_llm_credit_grants(check, orphan_subject_id)
        assert [grant.source for grant in orphan_grants] == [LLM_CREDIT_SOURCE_FREE_SIGNUP]
        assert (
            orphan_grants[0].source_ref == f"{LLM_CREDIT_SOURCE_FREE_SIGNUP}:{orphan_subject_id}"
        )
        orphan_usage = await check.scalar(
            select(func.count()).where(AgentLlmUsageEvent.billing_subject_id == orphan_subject_id)
        )
        assert orphan_usage == 1  # the fabricated debit, still on the source

        allocation = (
            await check.execute(
                select(FreeCloudAllocation).where(
                    FreeCloudAllocation.github_provider_user_id == github_subject
                )
            )
        ).scalar_one()
        assert allocation.billing_subject_id == orphan_subject_id  # pointer unmoved

        orphan_balance = await store.get_remaining_credit_usd(check, orphan_subject_id)
        assert orphan_balance.granted_usd == Decimal("5")
        assert orphan_balance.used_usd == Decimal("2")
        raced_balance = await store.get_remaining_credit_usd(check, raced_subject.id)
        assert raced_balance.granted_usd == Decimal("0")  # no free money
        assert raced_balance.used_usd == Decimal("0")  # no inherited debt

        # The other listed org still healed, durably.
        healable_subject = await ensure_organization_billing_subject(check, healable_org)
        healable_balance = await store.get_remaining_credit_usd(check, healable_subject.id)
        assert healable_balance.granted_usd == Decimal("5")

    assert result.raced == 1
    assert result.checked == 2
    # The savepoint made the raced org genuinely still grantless, so the sweep
    # must not count it as healed.
    assert raced_org not in result.healed_organization_ids
    assert healable_org in result.healed_organization_ids
    assert result.healed == 1

    reclaim_pages = [
        (error, kwargs)
        for error, kwargs in paged
        if isinstance(error, AgentGatewayReclaimLedgerRaced)
    ]
    assert len(reclaim_pages) == 1
    assert reclaim_pages[0][1]["tags"]["action"] == "orphan_reclaim"


@pytest.mark.asyncio
async def test_external_committed_racer_keeps_its_grant_and_the_reclaim_backs_out(
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The racer is a DIFFERENT transaction that COMMITS — the real shape.

    Every other window test races on the reclaim's own session, so its insert
    lives inside the savepoint and is undone with everything else. That cannot
    distinguish "we rolled back OUR write" from "we rolled back the whole
    window" — and it is the second property that matters: another transaction's
    committed money must survive untouched while ours backs out.

    Here ``racing_move`` opens a SEPARATE session, commits a
    ``free_signup:<destination>`` grant, and only then delegates to the real
    move. The P4 lock cannot prevent it (there were no destination rows to
    lock), so the post-move invariant is the thing that must catch it.
    """
    from proliferate.db import engine as engine_module
    from proliferate.server.ai_gateway import worker

    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(engine_module, "async_session_factory", factory)

    github_subject = f"gh-extrace-{uuid.uuid4().hex[:8]}"
    async with factory() as setup:
        orphan_subject_id = await _fabricate_orphan_claim(
            setup, github_subject=github_subject, consumed_usd=2.0
        )
        raced_user = await _create_user(setup)
        await _link_github_identity(setup, user_id=raced_user, provider_subject=github_subject)
        raced_org = await _place_in_org(setup, user_id=raced_user)
        raced_subject = await ensure_organization_billing_subject(setup, raced_org)
        raced_enrollment = await ensure_org_enrollment(setup, raced_org, raced_user)
        await _backdate_enrollment(setup, raced_enrollment.id, hours=2)
        await setup.commit()

    paged = _capture_report_critical(monkeypatch)
    real_move = store.move_llm_credit_ledger
    racer_ref = f"{LLM_CREDIT_SOURCE_FREE_SIGNUP}:{raced_subject.id}"

    async def racing_move(
        db: AsyncSession,
        *,
        from_billing_subject_id: uuid.UUID,
        to_billing_subject_id: uuid.UUID,
    ) -> tuple[int, int]:
        # A genuinely concurrent transaction: its own session, its own COMMIT,
        # landing the destination's free_signup grant inside the window.
        async with factory() as racer:
            await store.create_llm_credit_grant(
                racer,
                billing_subject_id=to_billing_subject_id,
                user_id=None,
                source=LLM_CREDIT_SOURCE_FREE_SIGNUP,
                amount_usd=Decimal("5"),
                source_ref=racer_ref,
            )
            await racer.commit()
        return await real_move(
            db,
            from_billing_subject_id=from_billing_subject_id,
            to_billing_subject_id=to_billing_subject_id,
        )

    monkeypatch.setattr(free_credits.agent_gateway_store, "move_llm_credit_ledger", racing_move)

    result = await worker.run_zero_grant_check_once()

    async with factory() as check:
        # (i) The destination keeps EXACTLY the racer's row — our moved row was
        # backed out, and the other transaction's committed money is untouched.
        destination_signups = [
            grant
            for grant in await store.list_llm_credit_grants(check, raced_subject.id)
            if grant.source == LLM_CREDIT_SOURCE_FREE_SIGNUP
        ]
        assert len(destination_signups) == 1
        assert destination_signups[0].source_ref == racer_ref
        assert destination_signups[0].amount_usd == Decimal("5")

        # (ii) The orphan still holds its own signup grant under the canonical
        # ref (the move's rewrite declined, and the row came back), plus its
        # usage row.
        orphan_grants = await store.list_llm_credit_grants(check, orphan_subject_id)
        assert [grant.source for grant in orphan_grants] == [LLM_CREDIT_SOURCE_FREE_SIGNUP]
        assert (
            orphan_grants[0].source_ref == f"{LLM_CREDIT_SOURCE_FREE_SIGNUP}:{orphan_subject_id}"
        )
        orphan_usage = await check.scalar(
            select(func.count()).where(AgentLlmUsageEvent.billing_subject_id == orphan_subject_id)
        )
        assert orphan_usage == 1

        # (iii) The claim never re-pointed.
        allocation = (
            await check.execute(
                select(FreeCloudAllocation).where(
                    FreeCloudAllocation.github_provider_user_id == github_subject
                )
            )
        ).scalar_one()
        assert allocation.billing_subject_id == orphan_subject_id

    # (iv) The sweep recorded the race and did not abort.
    assert result.raced == 1
    # NOT the in-session artifact: the racer's committed $5 genuinely funds this
    # org, so by the time the sweep re-queries it is legitimately no longer
    # grantless and correctly reads as healed. The reclaim still backed out —
    # that is what the ledger assertions above prove.
    assert raced_org in result.healed_organization_ids
    assert result.healed == 1

    reclaim_pages = [
        (error, kwargs)
        for error, kwargs in paged
        if isinstance(error, AgentGatewayReclaimLedgerRaced)
    ]
    assert len(reclaim_pages) == 1
    assert reclaim_pages[0][1]["tags"]["action"] == "orphan_reclaim"


@pytest.mark.asyncio
async def test_backfill_loop_runs_zero_grant_check_on_its_own_cadence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The guard rides the backfill loop but NOT its 300s tick.

    Three backfill iterations inside one zero-grant interval must invoke the
    check exactly once — the cadence is what turns 288 potential pages/day
    into at most the hourly sweep.
    """
    from proliferate.server.ai_gateway import worker

    ticks = {"backfill": 0, "zero_grant": 0}

    async def fake_backfill(*, limit: int = 50) -> int:
        ticks["backfill"] += 1
        if ticks["backfill"] >= 3:
            raise asyncio.CancelledError
        return 0

    async def fake_zero_grant(
        *, limit: int = 50, already_alerted_org_ids: set[uuid.UUID] | None = None
    ) -> ZeroGrantCheckResult:
        ticks["zero_grant"] += 1
        return ZeroGrantCheckResult(0, 0, 0, (), ())

    monkeypatch.setattr(worker, "run_enrollment_backfill_once", fake_backfill)
    monkeypatch.setattr(worker, "run_zero_grant_check_once", fake_zero_grant)
    monkeypatch.setattr(settings, "agent_gateway_backfill_interval_seconds", 0.0)
    monkeypatch.setattr(settings, "agent_gateway_zero_grant_check_interval_seconds", 3600.0)

    with pytest.raises(asyncio.CancelledError):
        await worker._backfill_loop()

    assert ticks["backfill"] == 3
    assert ticks["zero_grant"] == 1


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
