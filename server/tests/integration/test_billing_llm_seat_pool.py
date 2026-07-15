"""Integration coverage for the $5/seat shared org managed-LLM pool (A2/A10).

Ruled 2026-07-14: each active billed seat allocates $5 into a shared org
managed-LLM pool at each paid period; the allocation resets on renewal (unused
balance does not roll over) while purchased top-up credit never expires. Here we
drive the real ``_handle_invoice_paid`` seam and assert the ``seat_pool`` LLM
credit grant amount, period-keyed idempotency, and per-period reset via expiry.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.config import settings
from proliferate.constants.agent_gateway import LLM_CREDIT_SOURCE_SEAT_POOL
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db import engine as engine_module
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.agent_gateway import LlmCreditGrant
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject
from proliferate.server.billing import stripe_webhooks


async def _add_active_members(
    db_session: AsyncSession, organization_id: uuid.UUID, count: int
) -> None:
    for index in range(count):
        user_id = uuid.uuid4()
        db_session.add(
            User(
                id=user_id,
                email=f"seat-pool-{index}-{user_id}@example.com",
                hashed_password="unused",
                is_active=True,
                is_superuser=False,
                is_verified=True,
            )
        )
        db_session.add(
            OrganizationMembership(
                organization_id=organization_id,
                user_id=user_id,
                role=ORGANIZATION_ROLE_OWNER if index == 0 else ORGANIZATION_ROLE_MEMBER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                joined_at=datetime.now(UTC),
            )
        )

_PERIOD1_START = 1_776_586_422  # 2026-04-19T...
_PERIOD1_END = 1_779_178_422  # +30d
_PERIOD2_START = 1_779_178_422
_PERIOD2_END = 1_781_770_422


def _subscription_payload(
    *,
    subject_id: uuid.UUID,
    org_id: uuid.UUID,
    seats: int,
    start: int,
    end: int,
) -> dict:
    return {
        "id": "sub_llm_pool",
        "customer": "cus_llm_pool",
        "status": "active",
        "cancel_at_period_end": False,
        "canceled_at": None,
        "latest_invoice": "in_llm_pool",
        "current_period_start": start,
        "current_period_end": end,
        "metadata": {
            "billing_subject_id": str(subject_id),
            "organization_id": str(org_id),
            "purpose": "cloud_subscription",
        },
        "items": {
            "data": [
                {"id": "si_monthly", "quantity": seats, "price": {"id": "price_pro"}},
                {"id": "si_overage", "price": {"id": "price_overage"}},
            ]
        },
    }


def _invoice_payload(*, subject_id: uuid.UUID, org_id: uuid.UUID) -> dict:
    return {
        "id": "in_llm_pool",
        "customer": "cus_llm_pool",
        "subscription": None,
        "parent": {
            "subscription_details": {
                "subscription": "sub_llm_pool",
                "metadata": {
                    "billing_subject_id": str(subject_id),
                    "organization_id": str(org_id),
                    "purpose": "cloud_subscription",
                },
            },
            "type": "subscription_details",
        },
        "lines": {
            "data": [
                {
                    "id": "il_llm_pool",
                    "pricing": {
                        "price_details": {"price": "price_pro", "product": "prod_pro"},
                        "type": "price_details",
                    },
                    "parent": {
                        "subscription_item_details": {
                            "subscription": "sub_llm_pool",
                            "subscription_item": "si_monthly",
                        },
                        "type": "subscription_item_details",
                    },
                }
            ]
        },
    }


async def _list_seat_pool_grants(
    db_session: AsyncSession, subject_id: uuid.UUID
) -> list[LlmCreditGrant]:
    rows = await db_session.execute(
        select(LlmCreditGrant)
        .where(
            LlmCreditGrant.billing_subject_id == subject_id,
            LlmCreditGrant.source == LLM_CREDIT_SOURCE_SEAT_POOL,
        )
        .order_by(LlmCreditGrant.created_at.asc())
    )
    return list(rows.scalars().all())


@pytest.mark.asyncio
async def test_seat_pool_grants_five_per_seat_and_resets_each_period(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_managed_cloud_overage_price_id", "price_overage")

    organization = Organization(name="LLM Pool Org")
    db_session.add(organization)
    await db_session.flush()
    await _add_active_members(db_session, organization.id, 3)
    subject = await ensure_organization_billing_subject(db_session, organization.id)
    subject.stripe_customer_id = "cus_llm_pool"
    subject_id = subject.id
    org_id = organization.id
    await db_session.commit()

    seats = 3
    current = {"start": _PERIOD1_START, "end": _PERIOD1_END}

    async def fake_retrieve_subscription(subscription_id: str) -> dict:
        assert subscription_id == "sub_llm_pool"
        return _subscription_payload(
            subject_id=subject_id,
            org_id=org_id,
            seats=seats,
            start=current["start"],
            end=current["end"],
        )

    async def fake_update_subscription_item_quantity(**kwargs: object) -> None:
        return None

    monkeypatch.setattr(
        stripe_webhooks.stripe_billing, "retrieve_subscription", fake_retrieve_subscription
    )
    monkeypatch.setattr(
        stripe_webhooks.stripe_billing,
        "update_subscription_item_quantity",
        fake_update_subscription_item_quantity,
    )

    invoice = _invoice_payload(subject_id=subject_id, org_id=org_id)

    # Period 1: first invoice grants the pool; a replay is idempotent.
    await stripe_webhooks._handle_invoice_paid(invoice)
    await stripe_webhooks._handle_invoice_paid(invoice)
    db_session.expire_all()

    grants = await _list_seat_pool_grants(db_session, subject_id)
    assert len(grants) == 1
    # 3 seats * $5 = $15 into the shared org LLM pool.
    assert grants[0].amount_usd == Decimal("15")
    assert grants[0].expires_at == datetime.fromtimestamp(_PERIOD1_END, tz=UTC)

    # Period 2 (renewal): a fresh pool grant is issued for the new period.
    current["start"] = _PERIOD2_START
    current["end"] = _PERIOD2_END
    await stripe_webhooks._handle_invoice_paid(invoice)
    db_session.expire_all()

    grants = await _list_seat_pool_grants(db_session, subject_id)
    assert len(grants) == 2
    assert {g.amount_usd for g in grants} == {Decimal("15")}

    # Reset semantics: at a point inside period 2 the period-1 pool has expired,
    # so remaining reflects only the current period's $15 (no roll-over of the
    # first period's unused allocation).
    period2_midpoint = datetime.fromtimestamp(
        (_PERIOD2_START + _PERIOD2_END) // 2, tz=UTC
    )
    balance = await agent_gateway_store.get_remaining_credit_usd(
        db_session, subject_id, now=period2_midpoint
    )
    assert balance.granted_usd == Decimal("15")


@pytest.mark.asyncio
async def test_seat_pool_not_granted_when_gateway_disabled(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_managed_cloud_overage_price_id", "price_overage")

    organization = Organization(name="LLM Pool Off Org")
    db_session.add(organization)
    await db_session.flush()
    await _add_active_members(db_session, organization.id, 3)
    subject = await ensure_organization_billing_subject(db_session, organization.id)
    subject.stripe_customer_id = "cus_llm_pool"
    subject_id = subject.id
    org_id = organization.id
    await db_session.commit()

    async def fake_retrieve_subscription(subscription_id: str) -> dict:
        return _subscription_payload(
            subject_id=subject_id,
            org_id=org_id,
            seats=3,
            start=_PERIOD1_START,
            end=_PERIOD1_END,
        )

    async def fake_update_subscription_item_quantity(**kwargs: object) -> None:
        return None

    monkeypatch.setattr(
        stripe_webhooks.stripe_billing, "retrieve_subscription", fake_retrieve_subscription
    )
    monkeypatch.setattr(
        stripe_webhooks.stripe_billing,
        "update_subscription_item_quantity",
        fake_update_subscription_item_quantity,
    )

    await stripe_webhooks._handle_invoice_paid(
        _invoice_payload(subject_id=subject_id, org_id=org_id)
    )
    db_session.expire_all()

    assert await _list_seat_pool_grants(db_session, subject_id) == []
