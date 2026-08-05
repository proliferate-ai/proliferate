from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
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
from proliferate.integrations import stripe as stripe_billing
from proliferate.server.billing.models import BillingServiceError
from proliferate.server.billing.team_checkout import activation

NOW = datetime(2026, 8, 5, 12, 0, tzinfo=UTC)


def _metadata() -> dict[str, str]:
    return {
        "purpose": "team_subscription",
        "organization_checkout_intent_id": str(uuid4()),
        "organization_id": str(uuid4()),
        "created_by_user_id": str(uuid4()),
        "billing_subject_id": str(uuid4()),
    }


def _session(
    metadata: dict[str, str],
    *,
    subscription: object = "sub_team",
    customer: object = "cus_team",
) -> dict[str, object]:
    return {
        "id": "cs_team",
        "metadata": metadata,
        "subscription": subscription,
        "customer": customer,
    }


def _subscription(metadata: dict[str, str], *, status: str = "active") -> dict[str, object]:
    return {
        "id": "sub_team",
        "customer": "cus_team",
        "status": status,
        "metadata": dict(metadata),
    }


def _activation_record(metadata: dict[str, str]) -> CheckoutIntentWithOrganizationRecord:
    organization_id = UUID(metadata["organization_id"])
    creator_id = UUID(metadata["created_by_user_id"])
    intent = CheckoutIntentRecord(
        id=UUID(metadata["organization_checkout_intent_id"]),
        organization_id=organization_id,
        created_by_user_id=creator_id,
        billing_subject_id=UUID(metadata["billing_subject_id"]),
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
    return CheckoutIntentWithOrganizationRecord(
        intent=intent,
        organization=OrganizationRecord(
            id=organization_id,
            name="Activation Team",
            slug="activation-team",
            logo_domain="example.com",
            logo_image=None,
            status="pending_checkout",
            is_instance=False,
            created_at=NOW,
            updated_at=NOW,
        ),
    )


def _activated_record(
    locked: CheckoutIntentWithOrganizationRecord,
) -> OrganizationWithMembershipRecord:
    return OrganizationWithMembershipRecord(
        organization=replace(locked.organization, name="Activated Team", status="active"),
        membership=MembershipRecord(
            id=uuid4(),
            organization_id=locked.organization.id,
            user_id=locked.intent.created_by_user_id,
            role="owner",
            status="active",
            joined_at=NOW,
            removed_at=None,
        ),
    )


def _error_tuple(error: BillingServiceError) -> tuple[str, str, int]:
    return error.code, error.message, error.status_code


def _forbid_transaction() -> None:
    raise AssertionError("this branch must not open a database transaction")


class _ActivationHarness:
    def __init__(
        self,
        metadata: dict[str, str],
        *,
        subscription_status: str = "active",
        activation_result: CheckoutIntentWithOrganizationRecord | None,
        creator_email: str | None = "owner@example.com",
        failure_result: CheckoutIntentRecord | None = None,
        raise_at: str | None = None,
    ) -> None:
        self.metadata = metadata
        self.subscription = _subscription(metadata, status=subscription_status)
        self.activation_result = activation_result
        self.creator_email = creator_email
        self.failure_result = failure_result
        self.raise_at = raise_at
        self.db = cast(AsyncSession, object())
        self.active_transactions = 0
        self.transaction_count = 0
        self.trace: list[str] = []
        self.load_calls: list[dict[str, object]] = []
        self.failure_calls: list[dict[str, object]] = []
        self.creator_calls: list[tuple[AsyncSession, UUID]] = []
        self.begin_calls: list[dict[str, object]] = []
        self.upsert_calls: list[dict[str, object]] = []
        self.complete_calls: list[dict[str, object]] = []
        self.enrollment_calls: list[tuple[UUID, UUID]] = []
        self.staged_calls: list[dict[str, object]] = []

    @asynccontextmanager
    async def open_transaction(self) -> AsyncIterator[AsyncSession]:
        self.transaction_count += 1
        assert self.active_transactions == 0
        self.active_transactions += 1
        self.trace.append("transaction_enter")
        try:
            yield self.db
        finally:
            self.trace.append("transaction_exit")
            self.active_transactions -= 1

    async def retrieve(self, subscription_id: str) -> dict[str, object]:
        assert subscription_id == "sub_team"
        assert self.active_transactions == 0
        self.trace.append("stripe")
        return self.subscription

    async def load(self, actual_db: AsyncSession, **kwargs: object) -> object:
        self.trace.append("load")
        self.load_calls.append({"db": actual_db, **kwargs})
        return self.activation_result

    async def fail(self, actual_db: AsyncSession, **kwargs: object) -> object:
        self.trace.append("fail")
        self.failure_calls.append({"db": actual_db, **kwargs})
        return self.failure_result

    async def creator(self, actual_db: AsyncSession, user_id: UUID) -> object | None:
        self.trace.append("creator")
        self.creator_calls.append((actual_db, user_id))
        if self.creator_email is None:
            return None
        return SimpleNamespace(email=self.creator_email)

    async def begin(self, actual_db: AsyncSession, **kwargs: object) -> None:
        self.trace.append("begin")
        self.begin_calls.append({"db": actual_db, **kwargs})

    async def upsert(self, actual_db: AsyncSession, **kwargs: object) -> object:
        self.trace.append("upsert")
        self.upsert_calls.append({"db": actual_db, **kwargs})
        if self.raise_at == "upsert":
            raise RuntimeError("upsert failed")
        return object()

    async def complete(self, actual_db: AsyncSession, **kwargs: object) -> object:
        self.trace.append("complete")
        self.complete_calls.append({"db": actual_db, **kwargs})
        if self.raise_at == "complete":
            raise RuntimeError("complete failed")
        assert self.activation_result is not None
        return _activated_record(self.activation_result)

    def schedule_enrollment(self, organization_id: UUID, user_id: UUID) -> None:
        assert self.active_transactions == 0
        self.trace.append("enrollment")
        self.enrollment_calls.append((organization_id, user_id))

    async def send_staged(self, **kwargs: object) -> None:
        assert self.active_transactions == 0
        self.trace.append("staged")
        self.staged_calls.append(kwargs)

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(activation.db_session, "open_async_transaction", self.open_transaction)
        monkeypatch.setattr(activation.stripe_billing, "retrieve_subscription", self.retrieve)
        for name, replacement in (
            ("load_team_checkout_activation", self.load),
            ("fail_team_checkout_activation", self.fail),
            ("begin_team_checkout_activation", self.begin),
            ("complete_team_checkout_activation", self.complete),
            ("send_staged_team_checkout_invitations", self.send_staged),
        ):
            monkeypatch.setattr(activation.organization_service, name, replacement)
        monkeypatch.setattr(activation.user_store, "get_user_by_id", self.creator)
        monkeypatch.setattr(activation, "_upsert_team_subscription_from_stripe", self.upsert)
        monkeypatch.setattr(
            activation,
            "schedule_agent_gateway_org_enrollment",
            self.schedule_enrollment,
        )


@pytest.mark.asyncio
async def test_non_team_session_returns_before_stripe_or_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _forbid_stripe(_subscription_id: str) -> None:
        raise AssertionError("non-team sessions must not retrieve a subscription")

    monkeypatch.setattr(activation.stripe_billing, "retrieve_subscription", _forbid_stripe)
    monkeypatch.setattr(activation.db_session, "open_async_transaction", _forbid_transaction)

    await activation.activate_team_checkout_from_stripe_session(
        session={"metadata": {"purpose": "refill"}},
    )


@pytest.mark.parametrize("case", ["missing", "invalid", "subscription", "customer"])
@pytest.mark.asyncio
async def test_pre_stripe_validation_errors_are_exact_and_open_no_transaction(
    monkeypatch: pytest.MonkeyPatch,
    case: str,
) -> None:
    metadata = _metadata()
    subscription: object = "sub_team"
    customer: object = "cus_team"
    if case == "missing":
        metadata.pop("organization_id")
        expected = ("team_checkout_metadata_missing", "Team checkout metadata is incomplete.", 400)
    elif case == "invalid":
        metadata["organization_id"] = "not-a-uuid"
        expected = ("team_checkout_metadata_invalid", "Team checkout metadata is invalid.", 400)
    else:
        if case == "subscription":
            subscription = None
        else:
            customer = None
        expected = (
            "team_checkout_subscription_missing",
            "Team checkout session is missing its subscription.",
            400,
        )

    async def _forbid_stripe(_subscription_id: str) -> None:
        raise AssertionError("validation failures must precede Stripe retrieval")

    monkeypatch.setattr(activation.stripe_billing, "retrieve_subscription", _forbid_stripe)
    monkeypatch.setattr(activation.db_session, "open_async_transaction", _forbid_transaction)

    with pytest.raises(BillingServiceError) as raised:
        await activation.activate_team_checkout_from_stripe_session(
            session=_session(metadata, subscription=subscription, customer=customer),
        )

    assert _error_tuple(raised.value) == expected


@pytest.mark.asyncio
async def test_stripe_error_is_mapped_before_database_transaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    metadata = _metadata()

    async def _raise_stripe(_subscription_id: str) -> None:
        raise stripe_billing.StripeBillingError(
            "stripe_unavailable",
            "Stripe is unavailable.",
            status_code=503,
        )

    monkeypatch.setattr(activation.stripe_billing, "retrieve_subscription", _raise_stripe)
    monkeypatch.setattr(activation.db_session, "open_async_transaction", _forbid_transaction)

    with pytest.raises(BillingServiceError) as raised:
        await activation.activate_team_checkout_from_stripe_session(session=_session(metadata))

    assert _error_tuple(raised.value) == (
        "stripe_unavailable",
        "Stripe is unavailable.",
        503,
    )


@pytest.mark.asyncio
async def test_subscription_metadata_mismatch_precedes_database_transaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    metadata = _metadata()
    subscription = _subscription(metadata)
    cast(dict[str, str], subscription["metadata"])["organization_id"] = str(uuid4())

    async def _retrieve(_subscription_id: str) -> dict[str, object]:
        return subscription

    monkeypatch.setattr(activation.stripe_billing, "retrieve_subscription", _retrieve)
    monkeypatch.setattr(activation.db_session, "open_async_transaction", _forbid_transaction)

    with pytest.raises(BillingServiceError) as raised:
        await activation.activate_team_checkout_from_stripe_session(session=_session(metadata))

    assert _error_tuple(raised.value) == (
        "team_checkout_subscription_metadata_mismatch",
        "Team checkout subscription metadata does not match the checkout session.",
        409,
    )


@pytest.mark.parametrize("failure_present", [True, False])
@pytest.mark.asyncio
async def test_inactive_subscription_uses_only_owner_failure_command(
    monkeypatch: pytest.MonkeyPatch,
    failure_present: bool,
) -> None:
    metadata = _metadata()
    locked = _activation_record(metadata)
    harness = _ActivationHarness(
        metadata,
        subscription_status="past_due",
        activation_result=locked,
        failure_result=locked.intent if failure_present else None,
    )
    harness.install(monkeypatch)

    await activation.activate_team_checkout_from_stripe_session(
        session=_session(metadata),
        webhook_event_id="evt_inactive",
    )

    assert harness.trace == ["stripe", "transaction_enter", "fail", "transaction_exit"]
    assert harness.transaction_count == 1
    assert harness.failure_calls == [
        {
            "db": harness.db,
            "intent_id": locked.intent.id,
            "activation_status": "failed_billing_state",
            "error_code": "subscription_not_active",
            "error_message": "Team subscription is not active or trialing.",
            "webhook_event_id": "evt_inactive",
        }
    ]
    assert harness.active_transactions == 0


@pytest.mark.parametrize("case", ["missing", "mismatch"])
@pytest.mark.asyncio
async def test_active_load_errors_are_exact(
    monkeypatch: pytest.MonkeyPatch,
    case: str,
) -> None:
    metadata = _metadata()
    locked = _activation_record(metadata)
    if case == "missing":
        activation_result = None
        expected = (
            "team_checkout_intent_not_found",
            "Team checkout intent was not found.",
            404,
        )
    else:
        activation_result = replace(
            locked,
            intent=replace(locked.intent, organization_id=uuid4()),
        )
        expected = (
            "team_checkout_intent_mismatch",
            "Team checkout intent does not match Stripe metadata.",
            409,
        )
    harness = _ActivationHarness(metadata, activation_result=activation_result)
    harness.install(monkeypatch)

    with pytest.raises(BillingServiceError) as raised:
        await activation.activate_team_checkout_from_stripe_session(session=_session(metadata))

    assert _error_tuple(raised.value) == expected
    assert harness.trace == ["stripe", "transaction_enter", "load", "transaction_exit"]


@pytest.mark.asyncio
async def test_non_pending_intent_is_a_noop_after_locked_load(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    metadata = _metadata()
    locked = _activation_record(metadata)
    completed = replace(locked, intent=replace(locked.intent, status="completed"))
    harness = _ActivationHarness(metadata, activation_result=completed)
    harness.install(monkeypatch)

    await activation.activate_team_checkout_from_stripe_session(session=_session(metadata))

    assert harness.trace == ["stripe", "transaction_enter", "load", "transaction_exit"]


@pytest.mark.parametrize("case", ["organization", "creator"])
@pytest.mark.asyncio
async def test_active_business_failures_are_exact(
    monkeypatch: pytest.MonkeyPatch,
    case: str,
) -> None:
    metadata = _metadata()
    locked = _activation_record(metadata)
    if case == "organization":
        activation_result = replace(
            locked,
            organization=replace(locked.organization, status="active"),
        )
        creator_email = "owner@example.com"
        event_id = "evt_org_invalid"
        error_code = "organization_not_pending_checkout"
        error_message = "Team checkout organization is not pending checkout."
        middle_trace: list[str] = []
    else:
        activation_result = locked
        creator_email = None
        event_id = "evt_creator_missing"
        error_code = "checkout_creator_not_found"
        error_message = "Checkout creator account was not found."
        middle_trace = ["creator"]
    harness = _ActivationHarness(
        metadata,
        activation_result=activation_result,
        creator_email=creator_email,
    )
    harness.install(monkeypatch)

    await activation.activate_team_checkout_from_stripe_session(
        session=_session(metadata),
        webhook_event_id=event_id,
    )

    assert harness.trace == [
        "stripe",
        "transaction_enter",
        "load",
        *middle_trace,
        "fail",
        "transaction_exit",
    ]
    assert harness.failure_calls == [
        {
            "db": harness.db,
            "intent_id": locked.intent.id,
            "activation_status": "failed_business_state",
            "error_code": error_code,
            "error_message": error_message,
            "webhook_event_id": event_id,
        }
    ]


@pytest.mark.asyncio
async def test_happy_path_preserves_transaction_and_post_commit_trace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    metadata = _metadata()
    locked = _activation_record(metadata)
    harness = _ActivationHarness(metadata, activation_result=locked)
    harness.install(monkeypatch)

    await activation.activate_team_checkout_from_stripe_session(
        session=_session(metadata),
        webhook_event_id="evt_happy",
    )

    assert harness.trace == [
        "stripe",
        "transaction_enter",
        "load",
        "creator",
        "begin",
        "upsert",
        "complete",
        "transaction_exit",
        "enrollment",
        "staged",
    ]
    primary_calls = [
        harness.load_calls[0],
        {"db": harness.creator_calls[0][0]},
        harness.begin_calls[0],
        harness.upsert_calls[0],
        harness.complete_calls[0],
    ]
    assert all(call["db"] is harness.db for call in primary_calls)
    assert harness.creator_calls[0][1] == locked.intent.created_by_user_id
    assert harness.begin_calls[0] == {
        "db": harness.db,
        "intent_id": locked.intent.id,
        "created_by_user_id": locked.intent.created_by_user_id,
        "stripe_subscription_id": "sub_team",
    }
    assert harness.upsert_calls[0] == {
        "db": harness.db,
        "subscription": harness.subscription,
        "billing_subject_id": locked.intent.billing_subject_id,
    }
    assert harness.complete_calls[0] == {
        "db": harness.db,
        "intent_id": locked.intent.id,
        "stripe_subscription_id": "sub_team",
        "stripe_customer_id": "cus_team",
        "webhook_event_id": "evt_happy",
    }
    assert harness.enrollment_calls == [(locked.organization.id, locked.intent.created_by_user_id)]
    assert harness.staged_calls == [
        {
            "organization_id": locked.organization.id,
            "organization_name": "Activated Team",
            "invited_by_user_id": locked.intent.created_by_user_id,
            "inviter_email": "owner@example.com",
            "invite_emails_json": locked.intent.invite_emails_json,
        }
    ]
    assert harness.active_transactions == 0


@pytest.mark.parametrize("raise_at", ["upsert", "complete"])
@pytest.mark.asyncio
async def test_primary_failure_prevents_both_post_commit_effects(
    monkeypatch: pytest.MonkeyPatch,
    raise_at: str,
) -> None:
    metadata = _metadata()
    locked = _activation_record(metadata)
    harness = _ActivationHarness(metadata, activation_result=locked, raise_at=raise_at)
    harness.install(monkeypatch)

    with pytest.raises(RuntimeError, match=f"{raise_at} failed"):
        await activation.activate_team_checkout_from_stripe_session(session=_session(metadata))

    assert harness.enrollment_calls == []
    assert harness.staged_calls == []
    assert harness.trace[-1] == "transaction_exit"
    assert harness.active_transactions == 0
    if raise_at == "upsert":
        assert harness.complete_calls == []
    else:
        assert len(harness.complete_calls) == 1


def test_billing_activation_has_no_organization_store_imports() -> None:
    assert not hasattr(activation, "organization_store")
    assert not hasattr(activation, "invitation_store")
