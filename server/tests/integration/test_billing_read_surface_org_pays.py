"""The billing READ surface reports the paying org's pool over HTTP (W-F1).

Law W1 ("the org always pays") has to hold for what the client is *shown*, not
only for spend and money IN. These go over HTTP in the exact request shapes the
shipped clients send, because that is where the failure lived: the unit-level
payer resolution was already correct while every real client still rendered
"out of credits".

The specific trap is that ``cloud/sdk/src/client/billing.ts`` builds every
billing request through ``ownerQuery``/``ownerBody``, which emit
``ownerScope: owner?.ownerScope ?? "personal"``. So an owner-*less* call — the
sidebar consumption card, the new-workspace command, mobile settings — sends an
EXPLICIT ``personal`` scope rather than no scope at all. A redirect that only
covered unscoped requests would have looked correct in tests and still shipped
a broken sidebar, and those desktop builds are already in users' hands, so the
server has to be the authoritative side of the fix.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_SUBJECT_KIND_ORGANIZATION,
    BILLING_SUBJECT_KIND_PERSONAL,
)
from proliferate.db.models.billing import BillingSubscription
from proliferate.db.store.billing_runtime_usage import resolve_billing_subject_id_for_user
from proliferate.db.store.billing_subjects import (
    ensure_personal_billing_subject,
    get_billing_subject_by_id,
)
from tests.integration.test_billing_api import _register_and_login

# What the shipped SDK actually puts on the wire for an owner-less call.
SDK_OWNERLESS_QUERY = {"ownerScope": "personal"}

READ_ENDPOINTS = ("/v1/billing/cloud-plan", "/v1/billing/overview")


@pytest.fixture(autouse=True)
def _launch_billing_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin the launch configuration: enforce on, PRO off."""
    monkeypatch.setattr(settings, "cloud_billing_mode", "enforce")
    monkeypatch.setattr(settings, "pro_billing_enabled", False)


@pytest.mark.asyncio
async def test_sdk_shaped_personal_read_reports_the_paying_org_pool(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """``ownerScope=personal`` from the SDK must not read an empty personal pool.

    Registration places a hosted identity in its own default org, so the payer
    is an ORG subject and the free allowance is granted there. Before the fix
    this request resolved the caller's personal subject: no grant, zero hours,
    and ``startBlocked`` with ``credits_exhausted`` — an "out of credits" wall
    for a user whose pool was untouched.
    """
    session = await _register_and_login(client, "read-surface-sdk-personal@example.com")
    headers = {"Authorization": f"Bearer {session['access_token']}"}

    for path in READ_ENDPOINTS:
        response = await client.get(path, headers=headers, params=SDK_OWNERLESS_QUERY)
        assert response.status_code == 200, f"{path}: {response.text}"
        body = response.json()
        assert body["startBlocked"] is False, f"{path} blocked a user with a full pool"
        assert body["startBlockReason"] is None

    # Resolve the payer only AFTER the requests. This resolver WRITES (it ensures
    # the subject and re-homes the allowance), so calling it first leaves this
    # session holding an uncommitted INSERT on the very row the request then
    # blocks on — a genuine deadlock, not a flake.
    payer_subject_id = await resolve_billing_subject_id_for_user(
        db_session,
        uuid.UUID(session["user_id"]),
    )
    payer_subject = await get_billing_subject_by_id(db_session, payer_subject_id)
    assert payer_subject is not None
    assert payer_subject.kind == BILLING_SUBJECT_KIND_ORGANIZATION


@pytest.mark.asyncio
async def test_sdk_shaped_and_unscoped_reads_agree(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """The two shapes are the same question, so they must give the same answer.

    Web sends no scope; desktop and mobile send ``personal`` for the identical
    owner-less intent. Any divergence means one surface shows a balance the
    other contradicts, which is how the original bug presented — the web app
    looked fine while the desktop sidebar read zero.
    """
    session = await _register_and_login(client, "read-surface-agree@example.com")
    headers = {"Authorization": f"Bearer {session['access_token']}"}

    for path in READ_ENDPOINTS:
        unscoped = await client.get(path, headers=headers)
        sdk_shaped = await client.get(path, headers=headers, params=SDK_OWNERLESS_QUERY)
        assert unscoped.status_code == 200, unscoped.text
        assert sdk_shaped.status_code == 200, sdk_shaped.text
        assert unscoped.json() == sdk_shaped.json(), (
            f"{path} disagrees between web (unscoped) and desktop/mobile (personal)"
        )


@pytest.mark.asyncio
async def test_usage_summary_reports_the_paying_org_pool(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """``/usage/summary`` feeds the sidebar consumption card, so it redirects too.

    It reads through the same owner-context dependency, and it is the endpoint
    whose ``computeRemainingSeconds`` the user actually sees ticking down.
    """
    session = await _register_and_login(client, "read-surface-usage@example.com")
    headers = {"Authorization": f"Bearer {session['access_token']}"}

    unscoped = await client.get("/v1/billing/usage/summary", headers=headers)
    sdk_shaped = await client.get(
        "/v1/billing/usage/summary",
        headers=headers,
        params=SDK_OWNERLESS_QUERY,
    )
    assert unscoped.status_code == 200, unscoped.text
    assert sdk_shaped.status_code == 200, sdk_shaped.text
    assert unscoped.json() == sdk_shaped.json()
    assert unscoped.json()["computeRemainingSeconds"] > 0


@pytest.mark.asyncio
async def test_the_redirect_does_not_strand_a_personal_billing_subject(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Reading ``personal`` must not MINT a personal subject as a side effect.

    The pre-fix read path called ``ensure_personal_billing_subject_state``, so
    every sidebar poll created (and then reported) an empty personal subject for
    an org-paid user. Redirecting before that call is what keeps the payer
    unambiguous — a second subject with a zero balance is exactly the state that
    made the balance look lost.
    """
    session = await _register_and_login(client, "read-surface-no-strand@example.com")
    headers = {"Authorization": f"Bearer {session['access_token']}"}
    user_id = uuid.UUID(session["user_id"])

    for path in READ_ENDPOINTS:
        assert (
            await client.get(path, headers=headers, params=SDK_OWNERLESS_QUERY)
        ).status_code == 200

    payer_subject_id = await resolve_billing_subject_id_for_user(db_session, user_id)
    payer_subject = await get_billing_subject_by_id(db_session, payer_subject_id)
    assert payer_subject is not None
    assert payer_subject.kind == BILLING_SUBJECT_KIND_ORGANIZATION


@pytest.mark.asyncio
async def test_a_paying_personal_subscriber_is_not_demoted_to_free(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A live PERSONAL subscription keeps personal as the payer for reads.

    Subscriptions are still sold on the personal subject, because org
    subscriptions require PRO and PRO is off at launch. An unconditional redirect
    to the org therefore reported ``plan: free`` / ``isPaidCloud: false`` to a
    customer who was actively paying, revoking the unlimited hours and lifted
    concurrency limit they had bought — strictly worse than the stranded free
    balance the redirect exists to fix, and it would hit real paying accounts on
    day one. Free users still redirect; only genuine subscribers are exempt.
    """
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "price_cloud")

    session = await _register_and_login(client, "read-surface-paid-personal@example.com")
    headers = {"Authorization": f"Bearer {session['access_token']}"}
    user_id = uuid.UUID(session["user_id"])

    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_read_surface_paid"
    now = datetime.now(UTC)
    db_session.add(
        BillingSubscription(
            billing_subject_id=subject.id,
            stripe_subscription_id="sub_read_surface_paid",
            stripe_customer_id="cus_read_surface_paid",
            status="active",
            cancel_at_period_end=False,
            canceled_at=None,
            current_period_start=now - timedelta(days=1),
            current_period_end=now + timedelta(days=29),
            cloud_monthly_price_id="price_cloud",
            overage_price_id=None,
            monthly_subscription_item_id="si_read_surface_paid",
            metered_subscription_item_id=None,
            latest_invoice_id=None,
            latest_invoice_status=None,
            hosted_invoice_url=None,
        )
    )
    await db_session.commit()

    for params in (None, SDK_OWNERLESS_QUERY):
        response = await client.get("/v1/billing/cloud-plan", headers=headers, params=params)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["isPaidCloud"] is True, f"paying customer read as unpaid ({params})"
        assert body["plan"] == "cloud"
        assert body["startBlocked"] is False
        # A paid Cloud plan lifts the concurrency cap; ``None`` means unlimited.
        assert body["concurrentSandboxLimit"] is None

    # The read stayed on the subject that actually holds the subscription...
    paid_subject = await get_billing_subject_by_id(db_session, subject.id)
    assert paid_subject is not None
    assert paid_subject.kind == BILLING_SUBJECT_KIND_PERSONAL

    # ...and SPEND agrees. This is the important half: exempting only the read
    # produced a split-brain for precisely the paying customers — the UI showed
    # ``plan: cloud`` with unlimited hours while the start gate, segment-open, and
    # the reconciler resolved the org and refused every start. Both sides now come
    # through ``resolve_payer_organization_id_for_user``, so they cannot disagree.
    spend_subject_id = await resolve_billing_subject_id_for_user(db_session, user_id)
    assert spend_subject_id == subject.id, (
        "the read model and spend must resolve the same payer for a paying customer"
    )
