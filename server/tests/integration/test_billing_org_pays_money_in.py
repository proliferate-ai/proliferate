"""Law W1 for money IN: a user's balance lands on the subject that PAYS (W-F1).

Compute spend has obeyed "the org always pays" since the 2026-07-09 ruling — an
org member's ``usage_segment`` bills the org billing subject
(``test_billing_compute_attribution``). Money IN did not. The free allowance was
minted on the buyer's PERSONAL subject and refill checkout refused org scope
outright and charged personal, so hours were bought or granted into a pool
nothing ever spent from:

* ``_ensure_snapshot_free_grant`` returned early for any non-personal subject, so
  an org-membered user's org subject never got a free grant at all — the org pool
  was empty *by construction* while 5 free hours sat unspendable on personal.
  Under ``CLOUD_BILLING_MODE=enforce`` that blocks the user's very first start.
* ``create_refill_checkout_session`` raised 409
  ``refill_checkout_not_supported_for_org`` and billed the personal subject.

The read model disagreed with both in two further ways, each of which reports a
full org pool as ``remainingHours: 0`` / ``credits_exhausted``:

* ``current_owner_context`` fell back to PERSONAL scope whenever a request named
  no scope, so an unscoped billing read never saw the org pool at all.
* the owner-context read path resolves a subject, not a user, and an org subject
  has no ``user_id`` — so the per-user allowance was never minted on it.

These tests pin the repaired behaviour: the allowance follows the payer (moved,
never re-minted — ``billing_grant.source_ref`` is unique per user for life, so
re-homing must preserve ``remaining_seconds`` exactly), an org-less user is
untouched, and refill checkout is pointed at the paying org.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.auth.authorization import OwnerSelection
from proliferate.config import settings
from proliferate.constants.billing import (
    FREE_INCLUDED_GRANT_TYPE,
    REFILL_10H_GRANT_TYPE,
)
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingGrant
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.billing_runtime_usage import resolve_billing_subject_id_for_user
from proliferate.db.store.billing_subjects import (
    ensure_free_included_grant,
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.db import engine as engine_module
from proliferate.permissions import _default_unscoped_selection_to_payer
from proliferate.server.billing import checkout as checkout_module
from proliferate.server.billing import stripe_webhooks, webhook_drops
from proliferate.server.billing.snapshots import (
    get_billing_snapshot_for_request,
    get_billing_snapshot_for_subject_in_session,
)

FREE_HOURS = 5.0


async def _create_user(db_session: AsyncSession) -> User:
    user = User(
        email=f"orgpays-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _add_org_membership(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    *,
    name: str | None = None,
) -> uuid.UUID:
    org = Organization(name=name or f"org-{uuid.uuid4().hex[:8]}", status="active")
    db_session.add(org)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=org.id,
            user_id=user_id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
        )
    )
    await db_session.flush()
    return org.id


async def _free_grant(db_session: AsyncSession, user_id: uuid.UUID) -> BillingGrant | None:
    return (
        await db_session.execute(
            select(BillingGrant).where(
                BillingGrant.source_ref == f"{FREE_INCLUDED_GRANT_TYPE}:{user_id}"
            )
        )
    ).scalar_one_or_none()


@pytest.fixture(autouse=True)
def _launch_billing_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Launch configuration: PRO off, a nonzero free allowance."""
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    monkeypatch.setattr(settings, "cloud_free_sandbox_hours", FREE_HOURS)


@pytest.mark.asyncio
async def test_free_grant_lands_on_org_subject_for_org_member(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """A user who signs up into a default org gets their free hours on the ORG."""
    user = await _create_user(db_session)
    org_id = await _add_org_membership(db_session, user.id)

    payer_subject_id = await resolve_billing_subject_id_for_user(db_session, user.id)
    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    assert payer_subject_id == org_subject.id

    grant = await _free_grant(db_session, user.id)
    assert grant is not None, "the free allowance must exist for a brand-new org member"
    assert grant.billing_subject_id == org_subject.id
    assert grant.remaining_seconds == pytest.approx(FREE_HOURS * 3600.0)
    # The allowance stays attributed to the human it belongs to even though it
    # now lives in the org pool.
    assert grant.user_id == user.id


@pytest.mark.asyncio
async def test_org_less_user_keeps_free_grant_on_personal_subject(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """An org-less user's compute drains personal, so the allowance stays there."""
    user = await _create_user(db_session)

    payer_subject_id = await resolve_billing_subject_id_for_user(db_session, user.id)
    personal = await ensure_personal_billing_subject(db_session, user.id)
    assert payer_subject_id == personal.id

    grant = await _free_grant(db_session, user.id)
    assert grant is not None
    assert grant.billing_subject_id == personal.id


@pytest.mark.asyncio
async def test_joining_first_org_moves_the_existing_grant_and_preserves_balance(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """Re-homing MOVES the grant: partially-spent hours are neither re-granted nor lost."""
    user = await _create_user(db_session)
    personal = await ensure_personal_billing_subject(db_session, user.id)
    await ensure_free_included_grant(db_session, user.id, billing_subject_id=personal.id)
    grant = await _free_grant(db_session, user.id)
    assert grant is not None
    assert grant.billing_subject_id == personal.id

    # Spend part of the allowance while still org-less.
    spent_remaining = FREE_HOURS * 3600.0 - 900.0
    grant.remaining_seconds = spent_remaining
    await db_session.flush()

    org_id = await _add_org_membership(db_session, user.id)
    payer_subject_id = await resolve_billing_subject_id_for_user(db_session, user.id)
    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    assert payer_subject_id == org_subject.id

    moved = await _free_grant(db_session, user.id)
    assert moved is not None
    assert moved.billing_subject_id == org_subject.id
    assert moved.remaining_seconds == pytest.approx(spent_remaining), (
        "re-homing must carry the balance untouched — not re-grant spent hours"
    )
    # Exactly one allowance for life: the unique source_ref makes a second mint
    # impossible, and this asserts we did not work around it.
    rows = (
        await db_session.execute(
            select(BillingGrant.id).where(
                BillingGrant.user_id == user.id,
                BillingGrant.grant_type == FREE_INCLUDED_GRANT_TYPE,
            )
        )
    ).all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_snapshot_reports_org_pool_not_stranded_personal_balance(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """The read model an org member sees is the pool their compute drains."""
    user = await _create_user(db_session)
    org_id = await _add_org_membership(db_session, user.id)
    await db_session.commit()

    snapshot = await get_billing_snapshot_for_request(db_session, user.id)
    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    assert snapshot.billing_subject_id == org_subject.id
    assert snapshot.remaining_hours == pytest.approx(FREE_HOURS)
    assert snapshot.start_blocked is False


@pytest.mark.asyncio
async def test_org_subject_snapshot_mints_the_allowance_for_a_named_actor(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """An org-subject read issues the actor's allowance instead of reading empty.

    The free allowance is per-USER, but an org billing subject has no
    ``user_id`` of its own. The owner-context read path (``/billing/overview``,
    ``/cloud-plan``, ``/usage/summary``) resolves a subject, not a user, so
    without the actor threaded through it the mint was skipped and the org pool
    read as ``includedHours: 0`` / ``overQuota: true`` /
    ``credits_exhausted`` — a hard "out of credits" gate for a user whose hours
    had simply never been issued.
    """
    user = await _create_user(db_session)
    org_id = await _add_org_membership(db_session, user.id)
    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    await db_session.commit()

    # No actor: nothing to mint an allowance for, so the pool is legitimately empty.
    anonymous = await get_billing_snapshot_for_subject_in_session(db_session, org_subject.id)
    assert anonymous.included_hours == pytest.approx(0.0)

    named = await get_billing_snapshot_for_subject_in_session(
        db_session,
        org_subject.id,
        grant_user_id=user.id,
    )
    assert named.included_hours == pytest.approx(FREE_HOURS)
    assert named.remaining_hours == pytest.approx(FREE_HOURS)
    assert named.start_blocked is False
    assert named.over_quota is False

    grant = await _free_grant(db_session, user.id)
    assert grant is not None
    assert grant.billing_subject_id == org_subject.id


@pytest.mark.asyncio
async def test_loading_a_non_paying_org_snapshot_does_not_steal_the_grant(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """A second membership must not re-home the allowance away from the payer.

    The payer is the *current* membership (name-ordered first). Viewing another
    org's billing page loads that org's snapshot; if the mint were keyed on
    "the subject this snapshot is for" rather than "the subject that pays", the
    allowance would hop to the org being viewed and strand there.
    """
    user = await _create_user(db_session)
    payer_org_id = await _add_org_membership(db_session, user.id, name="aaa-payer-org")
    other_org_id = await _add_org_membership(db_session, user.id, name="zzz-other-org")
    payer_subject_id = await resolve_billing_subject_id_for_user(db_session, user.id)
    payer_subject = await ensure_organization_billing_subject(db_session, payer_org_id)
    other_subject = await ensure_organization_billing_subject(db_session, other_org_id)
    assert payer_subject_id == payer_subject.id
    await db_session.commit()

    await get_billing_snapshot_for_subject_in_session(db_session, other_subject.id)

    grant = await _free_grant(db_session, user.id)
    assert grant is not None
    assert grant.billing_subject_id == payer_subject.id


@pytest.mark.asyncio
async def test_refill_checkout_targets_the_paying_org(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unscoped refill purchase buys hours into the org pool, not personal."""
    user = await _create_user(db_session)
    org_id = await _add_org_membership(db_session, user.id)
    await db_session.commit()

    selection = await checkout_module._resolve_payer_owner_selection(db_session, user, None)
    assert selection.owner_scope == "organization"
    assert selection.organization_id == org_id


@pytest.mark.asyncio
async def test_refill_checkout_stays_personal_for_org_less_user(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """An org-less buyer's compute drains personal, so personal is correct."""
    user = await _create_user(db_session)
    await db_session.commit()

    selection = await checkout_module._resolve_payer_owner_selection(db_session, user, None)
    assert selection.owner_scope == "personal"
    assert selection.organization_id is None


@pytest.mark.asyncio
async def test_unscoped_read_resolves_the_paying_org_not_personal(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """A request that names no scope reads the payer's pool (law W1).

    ``current_owner_context`` used to fall back to personal whenever the client
    sent no ``ownerScope``/org header or cookie. With the allowance correctly
    homed on the org, that fallback made every unscoped billing read report the
    empty personal pool — ``remainingHours: 0`` and a ``credits_exhausted``
    start block for a user whose org pool is full. This is the same payer
    resolution spend and the start gate use.
    """
    user = await _create_user(db_session)
    org_id = await _add_org_membership(db_session, user.id)
    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    await db_session.commit()

    unscoped = await _default_unscoped_selection_to_payer(
        db_session,
        user,
        OwnerSelection(),
    )
    assert unscoped.owner_scope == "organization"
    assert unscoped.organization_id == org_id

    # An EXPLICIT personal request redirects to the payer too. That is not an
    # overreach: the shipped SDK hardcodes ``ownerScope: "personal"`` on every
    # owner-less billing call (``cloud/sdk/src/client/billing.ts``), so honoring
    # it literally means the sidebar and mobile settings read an empty pool on
    # builds already in users' hands. An org member has no personal pool to
    # inspect under org-everywhere, so naming it can only return zeros.
    explicit_personal = await _default_unscoped_selection_to_payer(
        db_session,
        user,
        OwnerSelection(owner_scope="personal"),
    )
    assert explicit_personal.owner_scope == "organization"
    assert explicit_personal.organization_id == org_id

    snapshot = await get_billing_snapshot_for_subject_in_session(
        db_session,
        org_subject.id,
        grant_user_id=user.id,
    )
    assert snapshot.remaining_hours == pytest.approx(FREE_HOURS)


@pytest.mark.asyncio
async def test_unscoped_read_stays_personal_for_an_org_less_user(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """An org-less user has no org to redirect to, so personal stands.

    Their personal subject really is the payer, so the redirect must be a no-op
    rather than an error — this is the self-hosted and single-user shape.
    """
    user = await _create_user(db_session)
    await db_session.commit()

    for selection_in in (OwnerSelection(), OwnerSelection(owner_scope="personal")):
        selection = await _default_unscoped_selection_to_payer(db_session, user, selection_in)
        assert selection.owner_scope == "personal"
        assert selection.organization_id is None


@pytest.mark.asyncio
async def test_grant_expiry_and_effective_window_survive_rehoming(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """Re-homing changes the pool and nothing else about the allowance."""
    user = await _create_user(db_session)
    personal = await ensure_personal_billing_subject(db_session, user.id)
    await ensure_free_included_grant(db_session, user.id, billing_subject_id=personal.id)
    before = await _free_grant(db_session, user.id)
    assert before is not None
    effective_at = before.effective_at
    hours_granted = before.hours_granted
    expires_at = before.expires_at
    grant_id = before.id

    await _add_org_membership(db_session, user.id)
    await resolve_billing_subject_id_for_user(db_session, user.id)

    after = await _free_grant(db_session, user.id)
    assert after is not None
    assert after.id == grant_id, "the same grant row moves; a new row is never minted"
    assert after.effective_at == effective_at
    assert after.hours_granted == hours_granted
    assert after.expires_at == expires_at


@pytest.mark.asyncio
async def test_paid_org_refill_webhook_credits_the_org_pool(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The far end of money IN: a paid org refill must actually land as a grant.

    Pointing refill checkout at the org (the fix above) is only half the flow.
    ``_handle_checkout_session_completed`` dropped any session whose subject had
    no ``user_id`` — which is EVERY org subject — so with checkout redirected the
    org could be charged and receive nothing, the worst failure shape available.
    ``user_id`` on a grant is a provenance stamp; consumption keys off
    ``billing_subject_id``, so the subject alone is enough to credit.
    """
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    monkeypatch.setattr(settings, "stripe_refill_10h_price_id", "price_refill_10h")

    user = await _create_user(db_session)
    org_id = await _add_org_membership(db_session, user.id)
    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    org_subject.stripe_customer_id = "cus_org_paid_refill"
    org_subject_id = org_subject.id
    await db_session.commit()

    async def fake_line_items(session_id: str) -> list[dict[str, object]]:
        return [{"id": "li_refill", "price": {"id": "price_refill_10h"}}]

    monkeypatch.setattr(
        stripe_webhooks.stripe_billing,
        "list_checkout_session_line_items",
        fake_line_items,
    )
    # A dropped payment pages on-call, so assert nothing was reported rather than
    # only that a grant exists.
    paged: list[object] = []
    monkeypatch.setattr(
        webhook_drops,
        "report_critical",
        lambda error, **kwargs: paged.append(error),
    )

    await stripe_webhooks._handle_checkout_session_completed(
        {
            "id": "cs_org_paid_refill",
            "mode": "payment",
            "payment_status": "paid",
            "customer": "cus_org_paid_refill",
            "metadata": {"purpose": "refill_10h", "billing_subject_id": str(org_subject_id)},
        },
        event_id="evt_org_paid_refill",
    )

    grants = list(
        (
            await db_session.execute(
                select(BillingGrant).where(
                    BillingGrant.billing_subject_id == org_subject_id,
                    BillingGrant.grant_type == REFILL_10H_GRANT_TYPE,
                )
            )
        )
        .scalars()
        .all()
    )
    assert paged == []
    assert len(grants) == 1
    assert grants[0].hours_granted == 10.0
    assert grants[0].source_ref == "stripe:checkout:cs_org_paid_refill:refill_10h"


@pytest.mark.asyncio
async def test_pro_billing_leaves_free_included_minting_to_the_snapshot_loader(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With PRO on, the payer resolver must not mint ``free_included``.

    PRO replaces the allowance with ``free_trial_v2``, whose issuance is
    personal-only and lives in the snapshot loader; minting here would fight it.
    PRO is off at launch (W-F2/W-F3 are the follow-ups), and this pins the guard
    so turning it on does not create a second allowance path.
    """
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    user = await _create_user(db_session)
    await _add_org_membership(db_session, user.id)

    await resolve_billing_subject_id_for_user(db_session, user.id)
    assert await _free_grant(db_session, user.id) is None
