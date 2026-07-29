"""Refill checkout over HTTP: the org buys the hours the org spends (W-F1).

Law W1 ("the org always pays") governs money IN as well as spend. This endpoint
used to raise 409 ``refill_checkout_not_supported_for_org`` for an org selection
and, unscoped, bill the buyer's PERSONAL subject — hours purchased into a pool
nothing ever spends from, because an org member's compute drains the org pool.

The subject-resolution law itself is pinned in
``test_billing_org_pays_money_in.py``; these cover the request/response surface
end to end, including the Stripe metadata the ``checkout.session.completed``
webhook credits against and the idempotency key that decides whether a customer
who already bought hours can buy more.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_SUBJECT_KIND_ORGANIZATION,
    REFILL_10H_GRANT_TYPE,
)
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.billing_runtime_usage import resolve_billing_subject_id_for_user
from proliferate.db.store.billing_subjects import (
    ensure_billing_grant_record,
    ensure_organization_billing_subject,
    get_billing_subject_by_id,
)
from proliferate.integrations import stripe as stripe_billing
from tests.integration.test_billing_api import _register_and_login


async def _org_owner(
    client: AsyncClient,
    db_session: AsyncSession,
    *,
    email: str,
    org_name: str,
) -> tuple[dict[str, str], Organization]:
    session = await _register_and_login(client, email)
    organization = Organization(name=org_name)
    db_session.add(organization)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=uuid.UUID(session["user_id"]),
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=datetime.now(UTC),
        )
    )
    await db_session.commit()
    return session, organization


@pytest.mark.asyncio
async def test_org_refill_checkout_buys_hours_into_the_org_pool(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An org owner's refill charges the ORG customer and credits the ORG subject."""
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    monkeypatch.setattr(settings, "stripe_refill_10h_price_id", "price_refill")
    monkeypatch.setattr(settings, "stripe_checkout_success_url", "https://app.test/success")
    monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "https://app.test/cancel")
    monkeypatch.setattr(
        settings,
        "stripe_customer_portal_return_url",
        "https://app.test/portal",
    )
    captured: dict[str, object] = {}

    async def fake_validate_refill_price_configuration() -> None:
        captured["validated"] = True

    async def fake_create_customer(**kwargs: object) -> dict[str, str]:
        captured["customer"] = kwargs
        return {"id": "cus_org_refill"}

    async def fake_create_refill_checkout_session(
        **kwargs: object,
    ) -> stripe_billing.StripeUrlResponse:
        captured["checkout"] = kwargs
        return stripe_billing.StripeUrlResponse(url="https://checkout.test/refill")

    monkeypatch.setattr(
        "proliferate.server.billing.checkout.validate_refill_price_configuration",
        fake_validate_refill_price_configuration,
    )
    monkeypatch.setattr(stripe_billing, "create_customer", fake_create_customer)
    monkeypatch.setattr(
        stripe_billing,
        "create_refill_checkout_session",
        fake_create_refill_checkout_session,
    )

    owner_session, organization = await _org_owner(
        client,
        db_session,
        email="billing-org-refill@example.com",
        org_name="Org Refill",
    )

    response = await client.post(
        "/v1/billing/refill-checkout",
        headers={"Authorization": f"Bearer {owner_session['access_token']}"},
        json={
            "ownerScope": "organization",
            "organizationId": str(organization.id),
        },
    )

    assert response.status_code == 200
    assert response.json()["url"] == "https://checkout.test/refill"
    # Read the subject only AFTER the request: the endpoint creates it in its own
    # session, and touching it first would leave this session holding an
    # uncommitted INSERT on the same row that the request then blocks on.
    org_subject = await ensure_organization_billing_subject(db_session, organization.id)
    checkout_kwargs = captured["checkout"]
    assert isinstance(checkout_kwargs, dict)
    # The Stripe session carries the ORG billing subject, so the
    # ``checkout.session.completed`` webhook credits the org grant pool.
    assert checkout_kwargs["billing_subject_id"] == str(org_subject.id)
    assert checkout_kwargs["stripe_customer_id"] == "cus_org_refill"


@pytest.mark.asyncio
async def test_unscoped_refill_checkout_buys_hours_into_the_org_pool(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A refill with no owner scope at all still charges the paying ORG.

    This is the shape the UI actually sends — the refill button posts an empty
    body — and it is the only shape that reaches the org redirect in
    ``_resolve_refill_owner_selection``. An explicitly scoped request returns
    from that resolver before it touches the database, so scoped tests alone
    left the redirect's transaction handling unexercised; live, an unscoped
    refill 500'd with "A transaction is already begun on this Session."
    """
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    monkeypatch.setattr(settings, "stripe_refill_10h_price_id", "price_refill")
    monkeypatch.setattr(settings, "stripe_checkout_success_url", "https://app.test/success")
    monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "https://app.test/cancel")
    monkeypatch.setattr(
        settings,
        "stripe_customer_portal_return_url",
        "https://app.test/portal",
    )
    captured: dict[str, object] = {}

    async def fake_validate_refill_price_configuration() -> None:
        captured["validated"] = True

    async def fake_create_customer(**kwargs: object) -> dict[str, str]:
        captured["customer"] = kwargs
        return {"id": "cus_unscoped_refill"}

    async def fake_create_refill_checkout_session(
        **kwargs: object,
    ) -> stripe_billing.StripeUrlResponse:
        captured["checkout"] = kwargs
        return stripe_billing.StripeUrlResponse(url="https://checkout.test/unscoped-refill")

    monkeypatch.setattr(
        "proliferate.server.billing.checkout.validate_refill_price_configuration",
        fake_validate_refill_price_configuration,
    )
    monkeypatch.setattr(stripe_billing, "create_customer", fake_create_customer)
    monkeypatch.setattr(
        stripe_billing,
        "create_refill_checkout_session",
        fake_create_refill_checkout_session,
    )

    # No second organization here: registration already places a hosted identity
    # in its own default org, and that default org is what an unscoped request
    # resolves as the payer.
    owner_session = await _register_and_login(client, "billing-unscoped-refill@example.com")

    response = await client.post(
        "/v1/billing/refill-checkout",
        headers={"Authorization": f"Bearer {owner_session['access_token']}"},
        json={},
    )

    assert response.status_code == 200
    assert response.json()["url"] == "https://checkout.test/unscoped-refill"
    # The purchase must land on whatever subject spend drains, so assert against
    # the payer resolver itself rather than a hand-built org subject.
    payer_subject_id = await resolve_billing_subject_id_for_user(
        db_session,
        uuid.UUID(owner_session["user_id"]),
    )
    payer_subject = await get_billing_subject_by_id(db_session, payer_subject_id)
    assert payer_subject is not None
    assert payer_subject.kind == BILLING_SUBJECT_KIND_ORGANIZATION
    checkout_kwargs = captured["checkout"]
    assert isinstance(checkout_kwargs, dict)
    assert checkout_kwargs["billing_subject_id"] == str(payer_subject_id)


@pytest.mark.asyncio
async def test_a_second_refill_purchase_gets_its_own_checkout_session(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Buying a second refill must not replay the first, spent session.

    Stripe replays an idempotency key for 24h. Keyed on subject + price + URLs
    alone, a customer who already bought hours got their COMPLETED session back
    — a dead "You're all done here" page — so an exhausted org could not top up,
    which under ``enforce`` means no way to unblock. Counting the refills the
    subject already holds advances the key per purchase; repeated clicks with no
    purchase in between must still collapse to one session.
    """
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    monkeypatch.setattr(settings, "stripe_refill_10h_price_id", "price_refill")
    monkeypatch.setattr(settings, "stripe_checkout_success_url", "https://app.test/success")
    monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "https://app.test/cancel")
    monkeypatch.setattr(
        settings,
        "stripe_customer_portal_return_url",
        "https://app.test/portal",
    )
    idempotency_keys: list[object] = []

    async def fake_validate_refill_price_configuration() -> None:
        return None

    async def fake_create_customer(**kwargs: object) -> dict[str, str]:
        return {"id": "cus_second_refill"}

    async def fake_create_refill_checkout_session(
        **kwargs: object,
    ) -> stripe_billing.StripeUrlResponse:
        idempotency_keys.append(kwargs["idempotency_key"])
        return stripe_billing.StripeUrlResponse(url="https://checkout.test/refill")

    monkeypatch.setattr(
        "proliferate.server.billing.checkout.validate_refill_price_configuration",
        fake_validate_refill_price_configuration,
    )
    monkeypatch.setattr(stripe_billing, "create_customer", fake_create_customer)
    monkeypatch.setattr(
        stripe_billing,
        "create_refill_checkout_session",
        fake_create_refill_checkout_session,
    )

    owner_session, organization = await _org_owner(
        client,
        db_session,
        email="billing-second-refill@example.com",
        org_name="Org Second Refill",
    )
    headers = {"Authorization": f"Bearer {owner_session['access_token']}"}
    body = {"ownerScope": "organization", "organizationId": str(organization.id)}

    first = await client.post("/v1/billing/refill-checkout", headers=headers, json=body)
    retry = await client.post("/v1/billing/refill-checkout", headers=headers, json=body)
    assert first.status_code == 200
    assert retry.status_code == 200
    assert idempotency_keys[0] == idempotency_keys[1], (
        "an impatient double-click must reuse one Stripe session"
    )

    # The purchase lands: exactly what the webhook does on payment.
    org_subject = await ensure_organization_billing_subject(db_session, organization.id)
    await ensure_billing_grant_record(
        db_session,
        user_id=None,
        billing_subject_id=org_subject.id,
        grant_type=REFILL_10H_GRANT_TYPE,
        hours_granted=10.0,
        effective_at=datetime.now(UTC),
        expires_at=None,
        source_ref=f"stripe:checkout:cs_first_{uuid.uuid4().hex[:8]}:refill_10h",
    )
    await db_session.commit()

    second = await client.post("/v1/billing/refill-checkout", headers=headers, json=body)
    assert second.status_code == 200
    assert idempotency_keys[2] != idempotency_keys[0], (
        "after a completed purchase the next refill needs a fresh Stripe session"
    )


@pytest.mark.asyncio
async def test_refill_checkout_is_still_unavailable_under_pro_billing(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PRO replaces refills with subscription overage, so the endpoint 409s.

    Unchanged by W-F1 and unrelated to owner scope: PRO is off at launch, and
    this pins that turning it on still closes the refill path rather than selling
    hours a PRO plan does not use.
    """
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    owner_session, organization = await _org_owner(
        client,
        db_session,
        email="billing-refill-pro@example.com",
        org_name="Org Refill Pro",
    )

    response = await client.post(
        "/v1/billing/refill-checkout",
        headers={"Authorization": f"Bearer {owner_session['access_token']}"},
        json={
            "ownerScope": "organization",
            "organizationId": str(organization.id),
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "refill_checkout_disabled"
