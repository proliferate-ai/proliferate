"""Visibility for Stripe webhook events the intake path drops.

``stripe_webhooks`` returns early whenever an event cannot be turned into a
grant, a hold, or a subscription projection, and also falls through to a bare
``return ()`` when the event type is not one of the six it dispatches at all.
Those early returns used to be completely silent while the receipt was still
marked ``processed``: Stripe never retried, and nothing recorded that money
had arrived without landing anywhere (W-F5). Every early return — 13 drop
points in total — now reports through here, which owns both the stable drop
vocabulary and the per-drop context each reason carries.

Levels follow the launch ruling "fail closed, loudly — never silent in either
direction":

* money already collected and no projection followed — logged at error and
  paged through ``report_critical``,
* routine traffic another handler owns (e.g. a subscription-mode checkout
  completion whose entitlement comes from ``invoice.paid``) — logged at info so
  the money-bearing signal is not buried, same rule as the materialization
  billing-block log,
* everything else — logged at warning.

The dispatch fall-through (``unhandled_event_type``) does not know whether
this specific event moved money — the payload was never parsed — so it keys
its level off the event type's family instead: ``invoice.*``, ``checkout.*``,
and ``payment_intent.*`` are treated as potentially money-bearing and page;
everything else warns.

Precondition on that family-prefix policy: it is inert for ordinary traffic
only because the live prod endpoint's ``enabled_events`` is scoped to exactly
the six types this module dispatches (verified 2026-07-28 against the live
Stripe endpoint config). If that scope is ever widened, a benign twin of a
handled type in the same family (e.g. ``invoice.payment_succeeded``, which
fires alongside essentially every ``invoice.paid``) would page every time.
Anyone widening ``enabled_events`` must first exclude such benign twins from
the money-bearing prefix match (or add per-type carve-outs) before doing so.

Current gaps: reporting a drop does not change intake semantics. The webhook
receipt is still marked ``processed``, so a dropped event stays unreplayable
from our side and Stripe will not resend it. A distinct ``ignored`` receipt
state (visible, replayable, not counted as success) is a deferred design
decision and is not part of this change.
"""

from __future__ import annotations

import logging
from typing import Any

from proliferate.config import settings
from proliferate.db.models.billing import BillingSubject, BillingSubscription
from proliferate.integrations.sentry import report_critical
from proliferate.server.billing.pricing import classify_monthly_price_id

logger = logging.getLogger(__name__)

DROP_LOG_EVENT = "stripe_webhook_dropped_event"
MONEY_IN_DROP_LOG_EVENT = "stripe_webhook_dropped_money_in_event"

# Stripe checkout ``payment_status`` values that mean no money was collected.
# Anything else on a completed session is treated as paid so the drop pages
# rather than hiding in a warning.
CHECKOUT_UNPAID_PAYMENT_STATUSES = {"unpaid", "no_payment_required"}


class DropReason:
    """Stable machine-readable drop reasons; log and alert rules key off these."""

    INVOICE_ID_NOT_STRING = "invoice_id_not_string"
    INVOICE_NO_CLOUD_LINE = "invoice_no_cloud_subscription_line"
    INVOICE_SUBJECT_UNRESOLVED = "invoice_subject_unresolved"
    INVOICE_GRANT_GATE_CLOSED = "invoice_period_grant_gate_closed"
    CHECKOUT_UNHANDLED_PURPOSE = "checkout_session_unhandled_mode_or_purpose"
    CHECKOUT_ID_NOT_STRING = "checkout_session_id_not_string"
    CHECKOUT_SUBJECT_UNRESOLVED = "checkout_session_subject_unresolved"
    CHECKOUT_PRICE_MISSING = "checkout_session_refill_price_missing"
    SUBSCRIPTION_FIELDS_NOT_STRINGS = "subscription_fields_not_strings"
    SUBSCRIPTION_SUBJECT_UNRESOLVED = "subscription_subject_unresolved"
    PAYMENT_FAILED_SUBJECT_UNRESOLVED = "payment_failed_subject_unresolved"
    PAYMENT_HOLD_SUBJECT_UNRESOLVED = "payment_hold_subject_unresolved"
    UNHANDLED_EVENT_TYPE = "unhandled_event_type"


# Event-type prefixes that name a money-moving Stripe object. An unhandled
# event in one of these families gets the money-bearing level policy even
# though we cannot tell from the type alone whether this specific event
# settled money — the risk of a silent regression in a money-adjacent family
# is itself what the "fail closed, loudly" ruling targets.
UNHANDLED_MONEY_BEARING_EVENT_TYPE_PREFIXES = ("invoice.", "checkout.", "payment_intent.")


def checkout_session_is_paid(session: dict[str, Any]) -> bool:
    """Whether Stripe already collected money for this checkout session.

    A non-``str`` ``payment_status`` (a hostile or malformed payload) is
    treated as not-paid rather than raising: the containment check below
    would otherwise throw ``TypeError: unhashable type`` for a list/dict
    value, which would escape to ``handle_stripe_webhook`` and mark the
    receipt ``failed`` (a 500) instead of routing through the drop reporter.
    """
    status = session.get("payment_status")
    if not isinstance(status, str):
        return False
    return status not in CHECKOUT_UNPAID_PAYMENT_STATUSES


def invoice_is_paid(invoice: dict[str, Any]) -> bool:
    """Whether Stripe already collected money for this invoice.

    ``invoice.paid`` events carry ``paid``/``status`` for the settled invoice;
    a missing marker counts as paid because the event type itself asserts it.
    """
    if invoice.get("paid") is False:
        return False
    status = invoice.get("status")
    return status is None or status == "paid"


def report_drop(
    drop_reason: str,
    event_id: object = None,
    object_id: object = None,
    *,
    money_received: bool = False,
    expected: bool = False,
    **context: object,
) -> None:
    """Record a Stripe event the intake path is dropping.

    ``event_id`` is the Stripe event id and ``object_id`` the id of the object
    the event carried (invoice, checkout session, or subscription). Both are
    accepted as ``object`` because the drop can be caused by the id not being
    a string in the first place.
    """
    extra: dict[str, object] = {
        "drop_reason": drop_reason,
        "stripe_event_id": event_id if isinstance(event_id, str) else None,
        "stripe_object_id": object_id if isinstance(object_id, str) else None,
        **context,
    }
    if money_received:
        logger.error(MONEY_IN_DROP_LOG_EVENT, extra=extra)
        report_critical(
            f"Stripe money-in event dropped without a projection: {drop_reason}",
            tags={"domain": "billing", "action": "stripe_webhook_drop"},
            extras=extra,
        )
        return
    if expected:
        logger.info(DROP_LOG_EVENT, extra=extra)
        return
    logger.warning(DROP_LOG_EVENT, extra=extra)


def report_checkout_unhandled_purpose(
    event_id: object,
    session: dict[str, Any],
    *,
    purpose: str | None,
) -> None:
    """Subscription-mode completions are entitled by ``invoice.paid``, and
    non-payment modes carry no money, so those are ordinary traffic. A
    payment-mode session that already collected money
    (``checkout_session_is_paid``) with no purpose we recognize is real money
    dropped with no projection, so that specific case pages instead."""
    money_received = session.get("mode") == "payment" and checkout_session_is_paid(session)
    report_drop(
        DropReason.CHECKOUT_UNHANDLED_PURPOSE,
        event_id,
        session.get("id"),
        money_received=money_received,
        expected=not money_received,
        session_mode=session.get("mode"),
        session_purpose=purpose,
    )


def report_checkout_id_not_string(event_id: object, session: dict[str, Any]) -> None:
    report_drop(
        DropReason.CHECKOUT_ID_NOT_STRING,
        event_id,
        money_received=checkout_session_is_paid(session),
    )


def report_checkout_subject_unresolved(
    event_id: object,
    session: dict[str, Any],
    session_id: str,
    subject: BillingSubject | None,
) -> None:
    """``subject`` is the resolved billing subject, or ``None`` when the customer
    could not be attributed at all; a subject without a user is also unusable."""
    subject_id = subject.id if subject is not None else None
    report_drop(
        DropReason.CHECKOUT_SUBJECT_UNRESOLVED,
        event_id,
        session_id,
        money_received=checkout_session_is_paid(session),
        subject_id=str(subject_id) if subject_id is not None else None,
        subject_resolved=subject_id is not None,
    )


def report_checkout_price_missing(
    event_id: object,
    session: dict[str, Any],
    session_id: str,
    subject: BillingSubject,
    line_items: list[Any],
) -> None:
    report_drop(
        DropReason.CHECKOUT_PRICE_MISSING,
        event_id,
        session_id,
        money_received=checkout_session_is_paid(session),
        subject_id=str(subject.id),
        line_item_count=len(line_items),
    )


def report_invoice_id_not_string(event_id: object, invoice: dict[str, Any]) -> None:
    report_drop(
        DropReason.INVOICE_ID_NOT_STRING,
        event_id,
        money_received=invoice_is_paid(invoice),
    )


def report_invoice_no_cloud_line(
    event_id: object,
    invoice: dict[str, Any],
    invoice_id: str,
    line_items: list[Any],
) -> None:
    report_drop(
        DropReason.INVOICE_NO_CLOUD_LINE,
        event_id,
        invoice_id,
        money_received=invoice_is_paid(invoice),
        line_item_count=len(line_items),
        pro_pricing_enabled=settings.pro_billing_enabled,
    )


def report_invoice_subject_unresolved(
    event_id: object,
    invoice: dict[str, Any],
    invoice_id: str,
    stripe_subscription_id: str | None,
) -> None:
    report_drop(
        DropReason.INVOICE_SUBJECT_UNRESOLVED,
        event_id,
        invoice_id,
        money_received=invoice_is_paid(invoice),
        stripe_subscription_id=stripe_subscription_id,
    )


def report_invoice_grant_gate_closed(
    event_id: object,
    invoice: dict[str, Any],
    invoice_id: str,
    subject: BillingSubject,
    subscription_record: BillingSubscription | None,
) -> None:
    """A paid cloud line resolved to a subject but issues no period grant.

    With Pro pricing off that is the ruled legacy shape (info, no page). With
    Pro pricing on, the closed gate is why a customer who paid sees no hours —
    the ``"money collected + no projection → error + page"`` case from this
    module's own level policy — so a paid invoice pages; an unpaid one (the
    event fired but Stripe has not actually settled money yet) only warns,
    since the four conditions that can shut the gate are still broken out in
    the context below for whichever level applies.
    """
    pro_pricing_enabled = settings.pro_billing_enabled
    price_id = subscription_record.cloud_monthly_price_id if subscription_record else None
    period_start = subscription_record.current_period_start if subscription_record else None
    paid = invoice_is_paid(invoice)
    report_drop(
        DropReason.INVOICE_GRANT_GATE_CLOSED,
        event_id,
        invoice_id,
        money_received=pro_pricing_enabled and paid,
        expected=not pro_pricing_enabled,
        subject_id=str(subject.id),
        pro_pricing_enabled=pro_pricing_enabled,
        has_subscription_record=subscription_record is not None,
        monthly_price_class=classify_monthly_price_id(price_id) if price_id else None,
        has_period_start=period_start is not None,
    )


def report_subscription_fields_not_strings(
    event_id: object,
    subscription_id: object,
    customer_id: object,
    status: object,
) -> None:
    """Which of the three required identifiers was not a string tells us whether
    Stripe sent an unexpected shape or the customer expansion came back empty."""
    report_drop(
        DropReason.SUBSCRIPTION_FIELDS_NOT_STRINGS,
        event_id,
        subscription_id,
        has_subscription_id=isinstance(subscription_id, str),
        has_customer_id=isinstance(customer_id, str),
        has_status=isinstance(status, str),
    )


def report_subscription_subject_unresolved(
    event_id: object,
    subscription_id: str,
    status: str,
) -> None:
    report_drop(
        DropReason.SUBSCRIPTION_SUBJECT_UNRESOLVED,
        event_id,
        subscription_id,
        subscription_status=status,
    )


def report_payment_failed_subject_unresolved(event_id: object, invoice_id: object) -> None:
    """No money moved, but the hold this event should have applied is lost: the
    failing customer keeps spending until another signal lands."""
    report_drop(DropReason.PAYMENT_FAILED_SUBJECT_UNRESOLVED, event_id, invoice_id)


def report_payment_hold_subject_unresolved(event_id: object, subscription_id: object) -> None:
    report_drop(DropReason.PAYMENT_HOLD_SUBJECT_UNRESOLVED, event_id, subscription_id)


def report_unhandled_event_type(event_id: object, event_type: object) -> None:
    """The dispatch fall-through: an event type outside the six handled here.

    This is a config-visibility gap, not confirmed lost money — we did not
    parse the payload, so we cannot tell whether money actually moved. Event
    types in a money-moving family (``invoice.*``, ``checkout.*``,
    ``payment_intent.*``) are treated as potentially money-bearing and paged;
    everything else warns.
    """
    money_bearing = isinstance(event_type, str) and event_type.startswith(
        UNHANDLED_MONEY_BEARING_EVENT_TYPE_PREFIXES
    )
    report_drop(
        DropReason.UNHANDLED_EVENT_TYPE,
        event_id,
        money_received=money_bearing,
        event_type=event_type if isinstance(event_type, str) else None,
    )
