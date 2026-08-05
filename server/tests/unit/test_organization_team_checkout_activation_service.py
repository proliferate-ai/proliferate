from __future__ import annotations

from datetime import UTC, datetime
from typing import cast, get_type_hints
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.organization_records import (
    CheckoutIntentRecord,
    CheckoutIntentWithOrganizationRecord,
    MembershipRecord,
    OrganizationRecord,
    OrganizationWithMembershipRecord,
)
from proliferate.server.organizations import service as organization_service

NOW = datetime(2026, 8, 5, 12, 0, tzinfo=UTC)


class _TransactionForbiddenSession:
    def begin(self) -> None:
        raise AssertionError("organization activation services must not open transactions")

    async def commit(self) -> None:
        raise AssertionError("organization activation services must not commit")

    async def rollback(self) -> None:
        raise AssertionError("organization activation services must not roll back")

    async def close(self) -> None:
        raise AssertionError("organization activation services must not close the caller session")


def _session() -> AsyncSession:
    return cast(AsyncSession, _TransactionForbiddenSession())


def _intent_record() -> CheckoutIntentRecord:
    return CheckoutIntentRecord(
        id=uuid4(),
        organization_id=uuid4(),
        created_by_user_id=uuid4(),
        billing_subject_id=uuid4(),
        team_name="Activation Team",
        status="pending",
        activation_status="not_started",
        activation_error_code=None,
        activation_error_message=None,
        last_webhook_event_id=None,
        stripe_checkout_session_id="cs_team",
        stripe_customer_id="cus_team",
        stripe_subscription_id=None,
        idempotency_key="checkout-key",
        invite_emails_json='["member@example.com"]',
        checkout_url="https://checkout.example/session",
        expires_at=NOW,
        completed_at=None,
        failed_at=None,
        cancelled_at=None,
        created_at=NOW,
        updated_at=NOW,
    )


def _organization_record(organization_id: UUID) -> OrganizationRecord:
    return OrganizationRecord(
        id=organization_id,
        name="Activation Team",
        slug="activation-team",
        logo_domain="example.com",
        logo_image=None,
        status="pending_checkout",
        is_instance=False,
        created_at=NOW,
        updated_at=NOW,
    )


def _activation_record() -> CheckoutIntentWithOrganizationRecord:
    intent = _intent_record()
    return CheckoutIntentWithOrganizationRecord(
        intent=intent,
        organization=_organization_record(intent.organization_id),
    )


def _activated_record(
    activation: CheckoutIntentWithOrganizationRecord,
) -> OrganizationWithMembershipRecord:
    return OrganizationWithMembershipRecord(
        organization=_organization_record(activation.organization.id),
        membership=MembershipRecord(
            id=uuid4(),
            organization_id=activation.organization.id,
            user_id=activation.intent.created_by_user_id,
            role="owner",
            status="active",
            joined_at=NOW,
            removed_at=None,
        ),
    )


@pytest.mark.parametrize("store_result", [_activation_record(), None])
@pytest.mark.asyncio
async def test_load_team_checkout_activation_forwards_session_and_result(
    monkeypatch: pytest.MonkeyPatch,
    store_result: CheckoutIntentWithOrganizationRecord | None,
) -> None:
    db = _session()
    intent_id = uuid4()
    calls: list[tuple[AsyncSession, UUID]] = []

    async def _load(actual_db: AsyncSession, actual_intent_id: UUID) -> object:
        calls.append((actual_db, actual_intent_id))
        return store_result

    monkeypatch.setattr(
        organization_service.organization_store,
        "load_team_checkout_activation_for_update",
        _load,
    )

    result = await organization_service.load_team_checkout_activation(
        db,
        intent_id=intent_id,
    )

    assert result is store_result
    assert calls == [(db, intent_id)]


@pytest.mark.parametrize("store_result", [_intent_record(), None])
@pytest.mark.asyncio
async def test_fail_team_checkout_activation_forwards_every_field(
    monkeypatch: pytest.MonkeyPatch,
    store_result: CheckoutIntentRecord | None,
) -> None:
    db = _session()
    intent_id = uuid4()
    calls: list[dict[str, object]] = []

    async def _fail(actual_db: AsyncSession, **kwargs: object) -> object:
        calls.append({"db": actual_db, **kwargs})
        return store_result

    monkeypatch.setattr(
        organization_service.organization_store,
        "mark_team_checkout_failed_by_id",
        _fail,
    )

    result = await organization_service.fail_team_checkout_activation(
        db,
        intent_id=intent_id,
        activation_status="failed_billing_state",
        error_code="subscription_not_active",
        error_message="Team subscription is not active or trialing.",
        webhook_event_id="evt_failure",
    )

    assert result is store_result
    assert calls == [
        {
            "db": db,
            "intent_id": intent_id,
            "activation_status": "failed_billing_state",
            "error_code": "subscription_not_active",
            "error_message": "Team subscription is not active or trialing.",
            "webhook_event_id": "evt_failure",
        }
    ]


@pytest.mark.asyncio
async def test_begin_team_checkout_activation_locks_before_marking(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _session()
    intent_id = uuid4()
    creator_id = uuid4()
    calls: list[tuple[str, object]] = []

    async def _lock(actual_db: AsyncSession, user_id: UUID) -> None:
        calls.append(("lock", (actual_db, user_id)))

    async def _mark(actual_db: AsyncSession, **kwargs: object) -> None:
        calls.append(("mark", {"db": actual_db, **kwargs}))

    monkeypatch.setattr(
        organization_service.organization_store,
        "acquire_membership_activation_lock",
        _lock,
    )
    monkeypatch.setattr(
        organization_service.organization_store,
        "mark_team_checkout_activating_by_id",
        _mark,
    )

    await organization_service.begin_team_checkout_activation(
        db,
        intent_id=intent_id,
        created_by_user_id=creator_id,
        stripe_subscription_id="sub_team",
    )

    assert calls == [
        ("lock", (db, creator_id)),
        (
            "mark",
            {
                "db": db,
                "intent_id": intent_id,
                "stripe_subscription_id": "sub_team",
            },
        ),
    ]


@pytest.mark.asyncio
async def test_begin_team_checkout_activation_propagates_mark_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _session()
    calls: list[str] = []

    async def _lock(_db: AsyncSession, _user_id: UUID) -> None:
        calls.append("lock")

    async def _mark(_db: AsyncSession, **_kwargs: object) -> None:
        calls.append("mark")
        raise RuntimeError("mark failed")

    monkeypatch.setattr(
        organization_service.organization_store,
        "acquire_membership_activation_lock",
        _lock,
    )
    monkeypatch.setattr(
        organization_service.organization_store,
        "mark_team_checkout_activating_by_id",
        _mark,
    )

    with pytest.raises(RuntimeError, match="mark failed"):
        await organization_service.begin_team_checkout_activation(
            db,
            intent_id=uuid4(),
            created_by_user_id=uuid4(),
            stripe_subscription_id="sub_team",
        )

    assert calls == ["lock", "mark"]


@pytest.mark.asyncio
async def test_complete_team_checkout_activation_forwards_every_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _session()
    activation = _activation_record()
    expected = _activated_record(activation)
    calls: list[dict[str, object]] = []

    async def _complete(actual_db: AsyncSession, **kwargs: object) -> object:
        calls.append({"db": actual_db, **kwargs})
        return expected

    monkeypatch.setattr(
        organization_service.organization_store,
        "complete_team_checkout_activation_by_id",
        _complete,
    )

    result = await organization_service.complete_team_checkout_activation(
        db,
        intent_id=activation.intent.id,
        stripe_subscription_id="sub_team",
        stripe_customer_id="cus_team",
        webhook_event_id="evt_team",
    )

    assert result is expected
    assert calls == [
        {
            "db": db,
            "intent_id": activation.intent.id,
            "stripe_subscription_id": "sub_team",
            "stripe_customer_id": "cus_team",
            "webhook_event_id": "evt_team",
        }
    ]


@pytest.mark.asyncio
async def test_staged_delivery_forwards_every_value_and_awaits_completion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    organization_id = uuid4()
    creator_id = uuid4()
    calls: list[dict[str, object]] = []
    completed = False

    async def _send(**kwargs: object) -> None:
        nonlocal completed
        calls.append(kwargs)
        completed = True

    monkeypatch.setattr(
        organization_service.invitation_delivery,
        "send_staged_team_checkout_invitations",
        _send,
    )

    await organization_service.send_staged_team_checkout_invitations(
        organization_id=organization_id,
        organization_name="Activation Team",
        invited_by_user_id=creator_id,
        inviter_email="owner@example.com",
        invite_emails_json='["member@example.com"]',
    )

    assert completed is True
    assert calls == [
        {
            "organization_id": organization_id,
            "organization_name": "Activation Team",
            "invited_by_user_id": creator_id,
            "inviter_email": "owner@example.com",
            "invite_emails_json": '["member@example.com"]',
        }
    ]


def test_activation_service_public_types_do_not_expose_organization_orm() -> None:
    functions = (
        organization_service.load_team_checkout_activation,
        organization_service.fail_team_checkout_activation,
        organization_service.begin_team_checkout_activation,
        organization_service.complete_team_checkout_activation,
    )

    for function in functions:
        for annotation in get_type_hints(function).values():
            assert "proliferate.db.models.organizations" not in repr(annotation)
