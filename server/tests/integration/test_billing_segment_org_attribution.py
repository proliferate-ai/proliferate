"""A segment's attribution scope is membership, not the payer (W-F1 review).

``usage_segment.organization_id`` and ``usage_segment.billing_subject_id``
answer two different questions and must be resolved separately:

* ``billing_subject_id`` — *who pays*. Under law W1 that is the org, except for
  a user already holding a healthy PERSONAL subscription (subscriptions are
  still sold personally while PRO is off), for whom personal genuinely is the
  payer.
* ``organization_id`` — *whose usage this is*. The org-scoped sums
  (``compute_usage_seconds_in_window_for_org``, feeding the compute budget caps
  and the org-admin usage-by-user view) filter on this column precisely so an
  org sees every member's compute "regardless of which subject each segment is
  invoiced to".

Collapsing them into one payer lookup silently un-scopes the personally-
subscribed member: their segments get ``organization_id = NULL``, so their
compute vanishes from their org's caps and from the admin usage view — an org
with a cap set could be run past it by exactly the members who pay the most.
That is the regression this pins.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_MODE_ENFORCE,
    BILLING_SUBJECT_KIND_ORGANIZATION,
    BILLING_SUBJECT_KIND_PERSONAL,
)
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingSubscription
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import billing as billing_store
from proliferate.db.store.billing_runtime_usage import ensure_sandbox_usage_started
from proliferate.db.store.billing_subjects import (
    ensure_personal_billing_subject,
    get_billing_subject_by_id,
)

CLOUD_PRICE_ID = "price_cloud_attr"


@pytest.fixture(autouse=True)
def _enforce_pro_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", CLOUD_PRICE_ID)


async def _org_member(db_session: AsyncSession) -> tuple[User, uuid.UUID]:
    user = User(
        email=f"segment-attr-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    org = Organization(name=f"org-{uuid.uuid4().hex[:8]}", status="active")
    db_session.add(org)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=org.id,
            user_id=user.id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
        )
    )
    await db_session.flush()
    return user, org.id


async def _give_personal_subscription(db_session: AsyncSession, user_id: uuid.UUID) -> None:
    """A healthy subscription on the user's PERSONAL subject.

    This is what makes them the exception to "the org always pays" — and so the
    only case where the payer and the attribution scope diverge.
    """
    subject = await ensure_personal_billing_subject(db_session, user_id)
    now = datetime.now(UTC)
    db_session.add(
        BillingSubscription(
            billing_subject_id=subject.id,
            stripe_subscription_id=f"sub_attr_{uuid.uuid4().hex[:8]}",
            stripe_customer_id=f"cus_attr_{uuid.uuid4().hex[:8]}",
            status="active",
            cancel_at_period_end=False,
            canceled_at=None,
            current_period_start=now - timedelta(days=1),
            current_period_end=now + timedelta(days=29),
            cloud_monthly_price_id=CLOUD_PRICE_ID,
            overage_price_id=None,
            monthly_subscription_item_id="si_monthly",
            metered_subscription_item_id=None,
            latest_invoice_id=None,
            latest_invoice_status=None,
            hosted_invoice_url=None,
        )
    )
    await db_session.flush()


@pytest.mark.asyncio
async def test_personal_subscriber_segment_still_counts_toward_their_org(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """The payer is personal, but the usage is still the org's.

    Both halves matter and they pull in opposite directions, which is why this
    asserts them together: bill the personal subject (they hold the
    subscription) while attributing to the org (they are a member). Before the
    fix ``organization_id`` came from the payer resolver, so it was NULL here and
    the org's compute caps could never see this member's usage.
    """
    user, org_id = await _org_member(db_session)
    await _give_personal_subscription(db_session, user.id)
    personal_subject = await ensure_personal_billing_subject(db_session, user.id)
    await db_session.commit()

    now = datetime.now(UTC)
    segment = await ensure_sandbox_usage_started(
        db_session,
        sandbox_id=uuid.uuid4(),
        actor_user_id=user.id,
        observed_at=now - timedelta(hours=1),
        source="provision",
        event_id=f"attr-{uuid.uuid4().hex[:8]}",
        external_sandbox_id=None,
        sandbox_execution_id=None,
        is_billable=True,
    )
    await db_session.commit()
    assert segment is not None

    subject = await get_billing_subject_by_id(db_session, segment.billing_subject_id)
    assert subject is not None
    assert subject.kind == BILLING_SUBJECT_KIND_PERSONAL, (
        "a user holding a healthy personal subscription pays personally"
    )
    assert segment.billing_subject_id == personal_subject.id
    assert segment.organization_id == org_id, (
        "attribution follows membership, not the payer — an org must see its "
        "members' compute whatever subject the segment is invoiced to"
    )

    # The consequence, not just the column: the org-scoped sum the compute budget
    # caps read must actually include this hour.
    seconds = await billing_store.compute_usage_seconds_in_window_for_org(
        db_session,
        organization_id=org_id,
        start=now - timedelta(days=1),
        end=now + timedelta(days=1),
        now=now,
    )
    assert seconds > 0.0, (
        "the org's compute cap sums by organization_id, so an unscoped segment "
        "would let a personally-subscribed member run past an org cap unseen"
    )


@pytest.mark.asyncio
async def test_org_paid_member_segment_bills_and_attributes_to_the_org(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """The ordinary case: no personal subscription, so both are the org.

    Kept alongside the divergent case so a future change cannot satisfy one by
    breaking the other.
    """
    user, org_id = await _org_member(db_session)
    await db_session.commit()

    now = datetime.now(UTC)
    segment = await ensure_sandbox_usage_started(
        db_session,
        sandbox_id=uuid.uuid4(),
        actor_user_id=user.id,
        observed_at=now - timedelta(hours=1),
        source="provision",
        event_id=f"attr-org-{uuid.uuid4().hex[:8]}",
        external_sandbox_id=None,
        sandbox_execution_id=None,
        is_billable=True,
    )
    await db_session.commit()
    assert segment is not None

    subject = await get_billing_subject_by_id(db_session, segment.billing_subject_id)
    assert subject is not None
    assert subject.kind == BILLING_SUBJECT_KIND_ORGANIZATION
    assert subject.organization_id == org_id
    assert segment.organization_id == org_id
