"""Stripe webhook verification and local billing event intake."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_PRICE_CLASS_PRO,
    PRO_PERIOD_GRANT_TYPE,
    REFILL_10H_GRANT_TYPE,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.billing import BillingSubject, BillingSubscription
from proliferate.db.store.billing import (
    apply_payment_failed_hold,
    claim_webhook_event,
    clear_payment_failed_holds,
    ensure_billing_grant_record,
    get_billing_subject_for_stripe_reference,
    get_billing_subscription_by_stripe_subscription_id,
    load_billing_subscription_by_id,
    mark_seat_adjustment_failed,
    mark_seat_adjustment_grant_issued,
    mark_seat_adjustment_stripe_confirmed,
    mark_webhook_event_failed_by_id,
    mark_webhook_event_processed_by_id,
    prepare_initial_org_seat_reconcile,
    upsert_stripe_subscription_record,
)
from proliferate.integrations.billing import stripe as stripe_billing
from proliferate.server.billing.domain.accounting import stripe_status_is_terminal
from proliferate.server.billing.domain.pricing import (
    monthly_subscription_price_ids,
    overage_subscription_price_ids,
)
from proliferate.server.billing.domain.seats import pro_period_grant_hours
from proliferate.server.billing.domain.webhooks import (
    datetime_from_timestamp as _datetime_from_timestamp,
)
from proliferate.server.billing.domain.webhooks import (
    event_object as _event_object,
)
from proliferate.server.billing.domain.webhooks import (
    id_from_expandable as _id_from_expandable,
)
from proliferate.server.billing.domain.webhooks import (
    invoice_subscription_id as _invoice_subscription_id,
)
from proliferate.server.billing.domain.webhooks import (
    line_is_cloud_subscription as classify_cloud_subscription_line,
)
from proliferate.server.billing.domain.webhooks import (
    line_items_from_object as _line_items_from_object,
)
from proliferate.server.billing.domain.webhooks import (
    metadata as _metadata,
)
from proliferate.server.billing.domain.webhooks import (
    subscription_item_details as parse_subscription_item_details,
)
from proliferate.server.billing.domain.webhooks import (
    subscription_parent_metadata as _subscription_parent_metadata,
)
from proliferate.server.billing.domain.webhooks import (
    subscription_period as _subscription_period,
)
from proliferate.server.billing.models import BillingServiceError, StripeWebhookAck
from proliferate.server.billing.pricing import (
    billing_price_ids_from_settings,
    classify_monthly_price_id,
)
from proliferate.server.billing.seats import pro_period_grant_source_ref
from proliferate.server.billing.service import activate_team_checkout_from_stripe_session
from proliferate.server.notifications import (
    BillingSlackEvent,
    BillingSlackNotification,
    deliver_billing_slack_notifications,
    load_billing_slack_notification_context,
)

STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300
STRIPE_PROVIDER = "stripe"
PAYMENT_HOLD_SOURCE = "stripe_webhook"
BILLING_SLACK_ACTIVE_STATUSES = {"active", "trialing"}
BILLING_SLACK_CANCELLED_STATUSES = {"canceled"}
BILLING_SLACK_PRE_START_STATUSES = {"incomplete"}

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StripeSignature:
    timestamp: int
    signatures: tuple[str, ...]


@dataclass(frozen=True)
class SubscriptionSyncResult:
    record: BillingSubscription | None
    notifications: tuple[BillingSlackNotification, ...] = ()


async def handle_stripe_webhook(
    *,
    payload: bytes,
    signature_header: str | None,
) -> StripeWebhookAck:
    if not settings.stripe_webhook_secret:
        raise BillingServiceError(
            "stripe_webhook_unconfigured",
            "Stripe webhook secret is not configured.",
            status_code=503,
        )
    _verify_stripe_signature(
        payload=payload,
        signature_header=signature_header,
        secret=settings.stripe_webhook_secret,
    )
    try:
        event = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise BillingServiceError(
            "stripe_webhook_invalid_json",
            "Stripe webhook payload is not valid JSON.",
            status_code=400,
        ) from exc

    event_id = event.get("id")
    event_type = event.get("type")
    if not isinstance(event_id, str) or not isinstance(event_type, str):
        raise BillingServiceError(
            "stripe_webhook_invalid_event",
            "Stripe webhook payload is missing an event id or type.",
            status_code=400,
        )

    claim = await claim_webhook_event(
        provider=STRIPE_PROVIDER,
        event_id=event_id,
        event_type=event_type,
    )
    if claim.status == "in_progress":
        raise BillingServiceError(
            "stripe_webhook_in_progress",
            "Stripe webhook event is already being processed.",
            status_code=409,
        )

    notifications: tuple[BillingSlackNotification, ...] = ()
    if claim.status == "claimed" and claim.receipt is not None:
        try:
            dispatch_notifications = await _dispatch_stripe_event(event)
        except Exception as exc:
            await mark_webhook_event_failed_by_id(receipt_id=claim.receipt.id, error=str(exc))
            raise
        notifications = tuple(dispatch_notifications or ())
        await mark_webhook_event_processed_by_id(receipt_id=claim.receipt.id)
        await deliver_billing_slack_notifications(notifications)

    livemode = event.get("livemode")
    return StripeWebhookAck(
        event_id=event_id,
        event_type=event_type,
        livemode=livemode if isinstance(livemode, bool) else None,
    )


async def _dispatch_stripe_event(event: dict[str, Any]) -> tuple[BillingSlackNotification, ...]:
    event_type = event.get("type")
    stripe_object = _event_object(event)
    if event_type == "checkout.session.completed":
        await _handle_checkout_session_completed(stripe_object, event_id=event.get("id"))
    elif event_type in {"customer.subscription.created", "customer.subscription.updated"}:
        result = await _sync_subscription_for_billing_notifications(
            stripe_object,
            event_type=event_type,
        )
        return result.notifications
    elif event_type == "customer.subscription.deleted":
        result = await _sync_subscription_for_billing_notifications(
            stripe_object,
            event_type=event_type,
        )
        await _apply_payment_hold_for_subscription(stripe_object)
        return result.notifications
    elif event_type == "invoice.paid":
        return await _handle_invoice_paid(stripe_object)
    elif event_type == "invoice.payment_failed":
        await _handle_invoice_payment_failed(stripe_object)
    return ()


def _line_is_cloud_subscription(line: dict[str, Any]) -> bool:
    return classify_cloud_subscription_line(
        line,
        pro_billing_enabled=settings.pro_billing_enabled,
        cloud_monthly_price_id=settings.stripe_cloud_monthly_price_id,
        price_ids=billing_price_ids_from_settings(),
    )


async def _subject_from_object(stripe_object: dict[str, Any]) -> BillingSubject | None:
    metadata = _metadata(stripe_object)
    subject_id = metadata.get("billing_subject_id")
    if subject_id is None:
        subject_id = _subscription_parent_metadata(stripe_object).get("billing_subject_id")
    billing_subject_id: UUID | None = None
    if subject_id:
        try:
            billing_subject_id = UUID(subject_id)
        except ValueError:
            return None
    return await get_billing_subject_for_stripe_reference(
        billing_subject_id=billing_subject_id,
        stripe_customer_id=_id_from_expandable(stripe_object.get("customer")),
    )


async def _handle_checkout_session_completed(
    session: dict[str, Any],
    *,
    event_id: object = None,
) -> None:
    if session.get("mode") == "subscription" and _metadata(session).get(
        "purpose"
    ) == "team_subscription":
        await activate_team_checkout_from_stripe_session(
            session=session,
            webhook_event_id=event_id if isinstance(event_id, str) else None,
        )
        return
    if session.get("mode") != "payment" or _metadata(session).get("purpose") != "refill_10h":
        return
    session_id = session.get("id")
    if not isinstance(session_id, str):
        return
    subject = await _subject_from_object(session)
    if subject is None or subject.user_id is None:
        return
    lines = await stripe_billing.list_checkout_session_line_items(session_id)
    if not stripe_billing.line_items_include_price(lines, settings.stripe_refill_10h_price_id):
        return
    await ensure_billing_grant_record(
        user_id=subject.user_id,
        billing_subject_id=subject.id,
        grant_type=REFILL_10H_GRANT_TYPE,
        hours_granted=10.0,
        effective_at=datetime.now(UTC),
        expires_at=None,
        source_ref=f"stripe:checkout:{session_id}:refill_10h",
    )


async def _sync_subscription(subscription: dict[str, Any]) -> BillingSubscription | None:
    subscription_id = subscription.get("id")
    customer_id = _id_from_expandable(subscription.get("customer"))
    status = subscription.get("status")
    if (
        not isinstance(subscription_id, str)
        or not isinstance(customer_id, str)
        or not isinstance(status, str)
    ):
        return None
    subject = await _subject_from_object(subscription)
    if subject is None:
        return None
    (
        monthly_item_id,
        metered_item_id,
        monthly_price_id,
        overage_price_id,
        seat_quantity,
    ) = _subscription_item_details(subscription)
    current_period_start, current_period_end = _subscription_period(
        subscription,
        monthly_item_id=monthly_item_id,
        metered_item_id=metered_item_id,
    )
    record = await upsert_stripe_subscription_record(
        billing_subject_id=subject.id,
        stripe_subscription_id=subscription_id,
        stripe_customer_id=customer_id,
        status=status,
        cancel_at_period_end=bool(subscription.get("cancel_at_period_end")),
        canceled_at=_datetime_from_timestamp(subscription.get("canceled_at")),
        current_period_start=current_period_start,
        current_period_end=current_period_end,
        cloud_monthly_price_id=monthly_price_id,
        overage_price_id=overage_price_id,
        monthly_subscription_item_id=monthly_item_id,
        metered_subscription_item_id=metered_item_id,
        latest_invoice_id=_id_from_expandable(subscription.get("latest_invoice")),
        latest_invoice_status=None,
        hosted_invoice_url=None,
        seat_quantity=seat_quantity,
        default_pro_overage_enabled=(
            settings.pro_billing_enabled
            and classify_monthly_price_id(monthly_price_id) == BILLING_PRICE_CLASS_PRO
            and status in {"active", "trialing"}
        ),
    )
    record = await _reconcile_initial_org_subscription_seats(record)
    await _sync_managed_credit_budget_for_subscription_subject(subject)
    return record


async def _sync_managed_credit_budget_for_subscription_subject(
    subject: BillingSubject,
) -> None:
    if subject.organization_id is None:
        return
    from proliferate.server.cloud.agent_auth.service import (
        sync_managed_credit_budget_for_organization,
    )

    await sync_managed_credit_budget_for_organization(subject.organization_id)


async def _sync_subscription_for_billing_notifications(
    subscription: dict[str, Any],
    *,
    event_type: str,
) -> SubscriptionSyncResult:
    subscription_id = subscription.get("id")
    previous = (
        await _load_billing_subscription_by_stripe_subscription_id(subscription_id)
        if isinstance(subscription_id, str)
        else None
    )
    record = await _sync_subscription(subscription)
    if record is None:
        return SubscriptionSyncResult(record=None)
    events = _billing_slack_events_for_subscription_transition(
        event_type=event_type,
        previous=previous,
        current=record,
    )
    notifications: list[BillingSlackNotification] = []
    for event in events:
        notification = await _build_billing_slack_notification(record, event)
        if notification is None:
            continue
        notifications.append(notification)
    return SubscriptionSyncResult(record=record, notifications=tuple(notifications))


def _billing_slack_events_for_subscription_transition(
    *,
    event_type: str,
    previous: BillingSubscription | None,
    current: BillingSubscription,
) -> tuple[BillingSlackEvent, ...]:
    if _subscription_has_cancel_intent(current):
        if event_type == "customer.subscription.deleted" or not _subscription_has_cancel_intent(
            previous
        ):
            return ("cancelled",)
        return ()

    if not _subscription_is_active(current):
        return ()

    if event_type == "customer.subscription.created":
        return ("subscribed",)
    if event_type in {"customer.subscription.updated", "invoice.paid"} and (
        previous is None or previous.status in BILLING_SLACK_PRE_START_STATUSES
    ):
        return ("subscribed",)

    return ()


async def _build_billing_slack_notification(
    record: BillingSubscription,
    event: BillingSlackEvent,
) -> BillingSlackNotification | None:
    try:
        context = await load_billing_slack_notification_context(
            billing_subject_id=record.billing_subject_id,
        )
    except Exception:
        logger.exception("Could not load billing Slack notification context")
        return None
    if context is None:
        return None
    return BillingSlackNotification(
        event=event,
        stripe_subscription_id=record.stripe_subscription_id,
        name=context.name,
        email=context.email,
        github=context.github,
        user_created_at=context.user_created_at,
        workspace_count=context.workspace_count,
        organization_user_count=context.organization_user_count,
    )


async def _load_billing_subscription_by_stripe_subscription_id(
    stripe_subscription_id: str,
) -> BillingSubscription | None:
    async with db_engine.async_session_factory() as db:
        return await get_billing_subscription_by_stripe_subscription_id(
            db,
            stripe_subscription_id,
        )


def _subscription_is_active(subscription: BillingSubscription | None) -> bool:
    return subscription is not None and subscription.status in BILLING_SLACK_ACTIVE_STATUSES


def _subscription_has_cancel_intent(subscription: BillingSubscription | None) -> bool:
    return subscription is not None and (
        subscription.cancel_at_period_end
        or subscription.canceled_at is not None
        or subscription.status in BILLING_SLACK_CANCELLED_STATUSES
    )


async def _reconcile_initial_org_subscription_seats(
    record: BillingSubscription,
) -> BillingSubscription:
    adjustment = await prepare_initial_org_seat_reconcile(
        billing_subscription_id=record.id,
    )
    if adjustment is None:
        reloaded = await load_billing_subscription_by_id(record.id)
        return reloaded or record
    try:
        await stripe_billing.update_subscription_item_quantity(
            subscription_item_id=adjustment.monthly_subscription_item_id,
            quantity=adjustment.target_quantity,
            idempotency_key=f"initial-seat-reconcile:{adjustment.id}:seats:{adjustment.target_quantity}",
        )
        await mark_seat_adjustment_stripe_confirmed(adjustment_id=adjustment.id)
        await mark_seat_adjustment_grant_issued(adjustment_id=adjustment.id)
    except stripe_billing.StripeBillingError as error:
        await mark_seat_adjustment_failed(
            adjustment_id=adjustment.id,
            error=error.message,
            terminal=stripe_status_is_terminal(error.status_code),
        )
        raise
    except Exception as error:
        await mark_seat_adjustment_failed(
            adjustment_id=adjustment.id,
            error=f"{type(error).__name__}: {error}",
        )
        raise
    reloaded = await load_billing_subscription_by_id(record.id)
    return reloaded or record


def _subscription_item_details(
    subscription: dict[str, Any],
) -> tuple[str | None, str | None, str | None, str | None, int | None]:
    price_ids = billing_price_ids_from_settings()
    details = parse_subscription_item_details(
        subscription,
        monthly_price_ids=monthly_subscription_price_ids(price_ids),
        overage_price_ids=overage_subscription_price_ids(price_ids),
    )
    return (
        details.monthly_item_id,
        details.metered_item_id,
        details.monthly_price_id,
        details.overage_price_id,
        details.seat_quantity,
    )


async def _handle_invoice_paid(invoice: dict[str, Any]) -> tuple[BillingSlackNotification, ...]:
    invoice_id = invoice.get("id")
    if not isinstance(invoice_id, str):
        return ()
    lines = _line_items_from_object(invoice)
    if not lines:
        lines = await stripe_billing.list_invoice_lines(invoice_id)
    cloud_line = next(
        (line for line in lines if _line_is_cloud_subscription(line)),
        None,
    )
    if cloud_line is None:
        return ()
    subject = await _subject_from_object(invoice)
    subscription_id = _invoice_subscription_id(invoice, lines)
    subscription_record: BillingSubscription | None = None
    notifications: tuple[BillingSlackNotification, ...] = ()
    if subscription_id:
        subscription = await stripe_billing.retrieve_subscription(subscription_id)
        sync_result = await _sync_subscription_for_billing_notifications(
            subscription,
            event_type="invoice.paid",
        )
        subscription_record = sync_result.record
        notifications = sync_result.notifications
        if subject is None:
            subject = await _subject_from_object(subscription)
    if subject is None:
        return notifications
    if (
        settings.pro_billing_enabled
        and subscription_record is not None
        and classify_monthly_price_id(subscription_record.cloud_monthly_price_id)
        == BILLING_PRICE_CLASS_PRO
        and subscription_record.current_period_start is not None
    ):
        period_start_unix = int(subscription_record.current_period_start.timestamp())
        await ensure_billing_grant_record(
            user_id=subject.user_id,
            billing_subject_id=subject.id,
            grant_type=PRO_PERIOD_GRANT_TYPE,
            hours_granted=pro_period_grant_hours(
                seat_quantity=subscription_record.seat_quantity,
            ),
            effective_at=subscription_record.current_period_start,
            expires_at=subscription_record.current_period_end,
            source_ref=pro_period_grant_source_ref(
                subscription_id=subscription_record.stripe_subscription_id,
                period_start_unix=period_start_unix,
            ),
            top_up_existing=True,
        )
    await clear_payment_failed_holds(billing_subject_id=subject.id)
    return notifications


async def _handle_invoice_payment_failed(invoice: dict[str, Any]) -> None:
    subject = await _subject_from_object(invoice)
    if subject is None:
        lines = _line_items_from_object(invoice)
        if not lines:
            invoice_id = invoice.get("id")
            if isinstance(invoice_id, str):
                lines = await stripe_billing.list_invoice_lines(invoice_id)
        subscription_id = _invoice_subscription_id(invoice, lines)
        if subscription_id:
            subscription = await stripe_billing.retrieve_subscription(subscription_id)
            subject = await _subject_from_object(subscription)
    if subject is None:
        return
    await apply_payment_failed_hold(
        billing_subject_id=subject.id,
        source=PAYMENT_HOLD_SOURCE,
        source_ref=_id_from_expandable(invoice.get("id")),
    )


async def _apply_payment_hold_for_subscription(subscription: dict[str, Any]) -> None:
    subject = await _subject_from_object(subscription)
    if subject is None:
        return
    await apply_payment_failed_hold(
        billing_subject_id=subject.id,
        source=PAYMENT_HOLD_SOURCE,
        source_ref=_id_from_expandable(subscription.get("id")),
    )


def _verify_stripe_signature(
    *,
    payload: bytes,
    signature_header: str | None,
    secret: str,
    now: int | None = None,
) -> None:
    signature = _parse_signature_header(signature_header)
    current_time = int(time.time()) if now is None else now
    if abs(current_time - signature.timestamp) > STRIPE_SIGNATURE_TOLERANCE_SECONDS:
        raise BillingServiceError(
            "stripe_webhook_stale_signature",
            "Stripe webhook signature timestamp is outside the allowed tolerance.",
            status_code=401,
        )
    signed_payload = str(signature.timestamp).encode("ascii") + b"." + payload
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, candidate) for candidate in signature.signatures):
        raise BillingServiceError(
            "stripe_webhook_invalid_signature",
            "Stripe webhook signature is invalid.",
            status_code=401,
        )


def _parse_signature_header(signature_header: str | None) -> StripeSignature:
    if not signature_header:
        raise BillingServiceError(
            "stripe_webhook_missing_signature",
            "Stripe webhook signature header is missing.",
            status_code=401,
        )
    fields: dict[str, list[str]] = {}
    for item in signature_header.split(","):
        key, separator, value = item.partition("=")
        if not separator:
            continue
        fields.setdefault(key, []).append(value)
    timestamps = fields.get("t") or []
    signatures = tuple(value for value in fields.get("v1", []) if value)
    try:
        timestamp = int(timestamps[0])
    except (IndexError, ValueError) as exc:
        raise BillingServiceError(
            "stripe_webhook_invalid_signature",
            "Stripe webhook signature timestamp is invalid.",
            status_code=401,
        ) from exc
    if not signatures:
        raise BillingServiceError(
            "stripe_webhook_invalid_signature",
            "Stripe webhook signature does not include a v1 signature.",
            status_code=401,
        )
    return StripeSignature(timestamp=timestamp, signatures=signatures)
