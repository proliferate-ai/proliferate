"""W-F5: Stripe webhook drops are visible, and only visible.

Before this coverage, ``stripe_webhooks`` returned early at 13 points with no
log and no alert, while ``mark_webhook_event_processed_by_id`` still ran — so
Stripe never retried and the drop left no trace. These tests pin both halves
per the launch ruling "fail closed, loudly": observability (each drop emits
its ``drop_reason`` + Stripe event id, money-bearing drops additionally page
``report_critical``) and zero behavior change (no grant, no notification,
receipt still ``processed``, non-money drops still do not page).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.config import settings
from proliferate.db import engine as engine_module
from proliferate.db.models.billing import BillingGrant, WebhookEventReceipt
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.server.billing import stripe_webhooks
from proliferate.server.billing import webhook_drops
from proliferate.server.billing.webhook_drops import DropReason

DROP_LOGGER = "proliferate.server.billing.webhook_drops"
APP_LOGGER = "proliferate"


@pytest.fixture(autouse=True)
def _observable_drop_logs():
    """Let ``caplog`` observe drop records: two test-harness artifacts hide
    them otherwise, neither applying to the running server —
    ``configure_server_logging`` sets ``propagate = False`` on the
    ``proliferate`` logger (caplog handles the root logger), and the
    migration fixture's alembic ``fileConfig`` disables loggers that already
    existed at collection time."""
    app_logger = logging.getLogger(APP_LOGGER)
    drop_logger = logging.getLogger(DROP_LOGGER)
    previous_propagate = app_logger.propagate
    previous_disabled = drop_logger.disabled
    app_logger.propagate = True
    drop_logger.disabled = False
    yield
    app_logger.propagate = previous_propagate
    drop_logger.disabled = previous_disabled


@pytest.fixture
def paged(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    """Capture the critical-alert seam the way the materialization tests do."""
    calls: list[dict[str, object]] = []

    def _report_critical(error: object, **kwargs: object) -> None:
        calls.append({"error": error, **kwargs})

    monkeypatch.setattr(webhook_drops, "report_critical", _report_critical)
    return calls


def _drop_records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [record for record in caplog.records if record.name == DROP_LOGGER]


def _assert_drop_logged(
    caplog: pytest.LogCaptureFixture,
    *,
    drop_reason: str,
    event_id: str | None,
    level: int,
) -> logging.LogRecord:
    matches = [
        record
        for record in _drop_records(caplog)
        if getattr(record, "drop_reason", None) == drop_reason
    ]
    assert len(matches) == 1, [
        getattr(record, "drop_reason", None) for record in _drop_records(caplog)
    ]
    record = matches[0]
    assert record.levelno == level
    assert record.stripe_event_id == event_id  # type: ignore[attr-defined]
    return record


def _use_test_engine(monkeypatch: pytest.MonkeyPatch, test_engine: object) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),  # type: ignore[arg-type]
    )


def _stripe_signature(payload: bytes, *, secret: str) -> str:
    timestamp = int(time.time())
    signed_payload = str(timestamp).encode("ascii") + b"." + payload
    digest = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


async def _grants(db_session: AsyncSession, subject_id: uuid.UUID) -> list[BillingGrant]:
    return list(
        (
            await db_session.execute(
                select(BillingGrant).where(BillingGrant.billing_subject_id == subject_id)
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.asyncio
async def test_paid_invoice_without_cloud_line_logs_and_pages(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    paged: list[dict[str, object]],
) -> None:
    """A settled invoice whose lines never classify as cloud is money dropped."""
    _use_test_engine(monkeypatch, test_engine)
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")

    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_no_cloud_line"
    subject_id = subject.id
    await db_session.commit()

    with caplog.at_level(logging.INFO, logger=DROP_LOGGER):
        notifications = await stripe_webhooks._handle_invoice_paid(
            {
                "id": "in_no_cloud_line",
                "customer": "cus_no_cloud_line",
                "status": "paid",
                "paid": True,
                "metadata": {"billing_subject_id": str(subject_id)},
                "lines": {
                    "data": [{"id": "il_unclassified", "price": {"id": "price_something_else"}}]
                },
            },
            event_id="evt_no_cloud_line",
        )

    # Behavior is unchanged: no notifications, no grant.
    assert notifications == ()
    assert await _grants(db_session, subject_id) == []

    record = _assert_drop_logged(
        caplog,
        drop_reason=DropReason.INVOICE_NO_CLOUD_LINE,
        event_id="evt_no_cloud_line",
        level=logging.ERROR,
    )
    assert record.stripe_object_id == "in_no_cloud_line"  # type: ignore[attr-defined]
    assert record.line_item_count == 1  # type: ignore[attr-defined]
    assert len(paged) == 1
    assert paged[0]["extras"]["drop_reason"] == DropReason.INVOICE_NO_CLOUD_LINE  # type: ignore[index]
    assert paged[0]["tags"] == {  # type: ignore[index]
        "domain": "billing",
        "action": "stripe_webhook_drop",
    }


@pytest.mark.asyncio
async def test_paid_refill_session_without_price_line_logs_and_pages(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    paged: list[dict[str, object]],
) -> None:
    """A paid refill checkout whose price line is absent loses a 10h grant."""
    _use_test_engine(monkeypatch, test_engine)
    monkeypatch.setattr(settings, "stripe_refill_10h_price_id", "price_refill_10h")

    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_refill_drop"
    subject_id = subject.id
    await db_session.commit()

    async def _line_items(session_id: str) -> list[dict[str, object]]:
        assert session_id == "cs_refill_drop"
        return [{"id": "li_other", "price": {"id": "price_unrelated"}}]

    monkeypatch.setattr(
        stripe_webhooks.stripe_billing,
        "list_checkout_session_line_items",
        _line_items,
    )

    with caplog.at_level(logging.INFO, logger=DROP_LOGGER):
        await stripe_webhooks._handle_checkout_session_completed(
            {
                "id": "cs_refill_drop",
                "mode": "payment",
                "payment_status": "paid",
                "customer": "cus_refill_drop",
                "metadata": {"purpose": "refill_10h", "billing_subject_id": str(subject_id)},
            },
            event_id="evt_refill_drop",
        )

    assert await _grants(db_session, subject_id) == []

    record = _assert_drop_logged(
        caplog,
        drop_reason=DropReason.CHECKOUT_PRICE_MISSING,
        event_id="evt_refill_drop",
        level=logging.ERROR,
    )
    assert record.stripe_object_id == "cs_refill_drop"  # type: ignore[attr-defined]
    assert record.subject_id == str(subject_id)  # type: ignore[attr-defined]
    assert len(paged) == 1


@pytest.mark.asyncio
async def test_paid_refill_session_with_unresolved_subject_logs_and_pages(
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    paged: list[dict[str, object]],
) -> None:
    """A paid refill checkout we cannot attribute is money we cannot credit."""
    _use_test_engine(monkeypatch, test_engine)
    monkeypatch.setattr(settings, "stripe_refill_10h_price_id", "price_refill_10h")

    called: list[str] = []

    async def _line_items(session_id: str) -> list[dict[str, object]]:
        called.append(session_id)
        return []

    monkeypatch.setattr(
        stripe_webhooks.stripe_billing,
        "list_checkout_session_line_items",
        _line_items,
    )

    with caplog.at_level(logging.INFO, logger=DROP_LOGGER):
        await stripe_webhooks._handle_checkout_session_completed(
            {
                "id": "cs_refill_orphan",
                "mode": "payment",
                "payment_status": "paid",
                "customer": "cus_unknown_to_us",
                "metadata": {"purpose": "refill_10h"},
            },
            event_id="evt_refill_orphan",
        )

    # Unchanged short-circuit: we never reach the Stripe line-items call.
    assert called == []

    record = _assert_drop_logged(
        caplog,
        drop_reason=DropReason.CHECKOUT_SUBJECT_UNRESOLVED,
        event_id="evt_refill_orphan",
        level=logging.ERROR,
    )
    assert record.subject_resolved is False  # type: ignore[attr-defined]
    assert len(paged) == 1


@pytest.mark.asyncio
async def test_paid_invoice_with_unresolved_subject_logs_and_pages(
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    paged: list[dict[str, object]],
) -> None:
    """A settled cloud invoice with no billing subject is unattributable money."""
    _use_test_engine(monkeypatch, test_engine)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")

    with caplog.at_level(logging.INFO, logger=DROP_LOGGER):
        notifications = await stripe_webhooks._handle_invoice_paid(
            {
                "id": "in_orphan_subject",
                "customer": "cus_unknown_to_us",
                "status": "paid",
                "paid": True,
                "subscription": None,
                "lines": {"data": [{"id": "il_orphan", "price": {"id": "price_cloud"}}]},
            },
            event_id="evt_orphan_subject",
        )

    assert notifications == ()
    record = _assert_drop_logged(
        caplog,
        drop_reason=DropReason.INVOICE_SUBJECT_UNRESOLVED,
        event_id="evt_orphan_subject",
        level=logging.ERROR,
    )
    assert record.stripe_object_id == "in_orphan_subject"  # type: ignore[attr-defined]
    assert record.stripe_subscription_id is None  # type: ignore[attr-defined]
    assert len(paged) == 1


@pytest.mark.asyncio
async def test_subscription_with_unresolved_subject_warns_without_paging(
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    paged: list[dict[str, object]],
) -> None:
    """A subscription we cannot attribute warns; no money moved, so no page."""
    _use_test_engine(monkeypatch, test_engine)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")

    with caplog.at_level(logging.INFO, logger=DROP_LOGGER):
        record_result = await stripe_webhooks._sync_subscription(
            {
                "id": "sub_orphan",
                "customer": "cus_unknown_to_us",
                "status": "active",
                "items": {"data": [{"id": "si_orphan", "price": {"id": "price_cloud"}}]},
            },
            event_id="evt_sub_orphan",
        )

    assert record_result is None
    record = _assert_drop_logged(
        caplog,
        drop_reason=DropReason.SUBSCRIPTION_SUBJECT_UNRESOLVED,
        event_id="evt_sub_orphan",
        level=logging.WARNING,
    )
    assert record.stripe_object_id == "sub_orphan"  # type: ignore[attr-defined]
    assert record.subscription_status == "active"  # type: ignore[attr-defined]
    assert paged == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("session", "level", "should_page"),
    [
        # Other purposes are entitled elsewhere: visible, not a page.
        (
            {
                "id": "cs_setup_only",
                "mode": "setup",
                "metadata": {"purpose": "payment_method_update"},
            },
            logging.INFO,
            False,
        ),
        # Payment mode + already-collected money + unrecognized purpose: pages.
        (
            {
                "id": "cs_paid_unknown_purpose",
                "mode": "payment",
                "payment_status": "paid",
                "metadata": {"purpose": "some_future_purpose"},
            },
            logging.ERROR,
            True,
        ),
        # R2: a non-str payment_status (hostile shape) must not raise
        # TypeError: unhashable in the `not in` check — treated as not-paid.
        (
            {
                "id": "cs_hostile_payment_status",
                "mode": "payment",
                "payment_status": ["paid"],
                "metadata": {"purpose": "some_future_purpose"},
            },
            logging.INFO,
            False,
        ),
    ],
)
async def test_checkout_unhandled_purpose_level_follows_paid_status(
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    paged: list[dict[str, object]],
    session: dict[str, object],
    level: int,
    should_page: bool,
) -> None:
    _use_test_engine(monkeypatch, test_engine)
    event_id = f"evt_{session['id']}"

    with caplog.at_level(logging.INFO, logger=DROP_LOGGER):
        await stripe_webhooks._handle_checkout_session_completed(session, event_id=event_id)

    record = _assert_drop_logged(
        caplog, drop_reason=DropReason.CHECKOUT_UNHANDLED_PURPOSE, event_id=event_id, level=level
    )
    assert record.session_mode == session["mode"]  # type: ignore[attr-defined]
    assert len(paged) == (1 if should_page else 0)
    if should_page:
        assert paged[0]["extras"]["drop_reason"] == DropReason.CHECKOUT_UNHANDLED_PURPOSE  # type: ignore[index]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("event_type", "level", "should_page"),
    [
        # invoice.* is money-moving: pages (13th silent drop, dispatch fall-through).
        ("invoice.payment_succeeded", logging.ERROR, True),
        # Not a money-moving family: warns, no page.
        ("customer.updated", logging.WARNING, False),
    ],
)
async def test_unhandled_event_type_level_follows_type_family(
    caplog: pytest.LogCaptureFixture,
    paged: list[dict[str, object]],
    event_type: str,
    level: int,
    should_page: bool,
) -> None:
    with caplog.at_level(logging.INFO, logger=DROP_LOGGER):
        notifications = await stripe_webhooks._dispatch_stripe_event(
            {"id": f"evt_unhandled_{event_type}", "type": event_type}
        )

    assert notifications == ()
    record = _assert_drop_logged(
        caplog,
        drop_reason=DropReason.UNHANDLED_EVENT_TYPE,
        event_id=f"evt_unhandled_{event_type}",
        level=level,
    )
    assert record.event_type == event_type  # type: ignore[attr-defined]
    assert len(paged) == (1 if should_page else 0)


@pytest.mark.asyncio
async def test_handled_event_types_do_not_emit_unhandled_event_type(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A handled type must not also trip the fall-through's reporter, even
    though it drops for its own (distinct) reason."""
    with caplog.at_level(logging.INFO, logger=DROP_LOGGER):
        await stripe_webhooks._dispatch_stripe_event(
            {"id": "evt_handled_checkout", "type": "checkout.session.completed", "data": {}}
        )
    assert not any(
        getattr(record, "drop_reason", None) == DropReason.UNHANDLED_EVENT_TYPE
        for record in _drop_records(caplog)
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("pro_billing_enabled", [True, False])
async def test_invoice_grant_gate_closed_level_follows_pro_pricing(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    paged: list[dict[str, object]],
    pro_billing_enabled: bool,
) -> None:
    """The ``else:`` arm of the period-grant gate: Pro-on + gate closed pages
    (money collected, no projection -> error + page), Pro-off is the ruled
    legacy shape (info, never a page). Exercises the detached-ORM read
    (``subscription_record`` loaded under ``expire_on_commit=False``) without
    raising."""
    _use_test_engine(monkeypatch, test_engine)
    monkeypatch.setattr(settings, "pro_billing_enabled", pro_billing_enabled)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    # Cloud-line classification keys off a different price id per flag value.
    line_price_id = "price_pro" if pro_billing_enabled else "price_cloud"

    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_gate_closed"
    subject_id = subject.id
    await db_session.commit()

    async def _retrieve_subscription(subscription_id: str) -> dict[str, object]:
        assert subscription_id == "sub_gate_closed"
        return {
            "id": "sub_gate_closed",
            "customer": "cus_gate_closed",
            # "incomplete" avoids also emitting a "subscribed" Slack notification.
            "status": "incomplete",
            "cancel_at_period_end": False,
            "canceled_at": None,
            "latest_invoice": "in_gate_closed",
            "metadata": {"billing_subject_id": str(subject_id)},
            # No current_period_start/end anywhere -> gate stays closed.
            "items": {
                "data": [{"id": "si_gate_closed", "quantity": 1, "price": {"id": "price_pro"}}]
            },
        }

    monkeypatch.setattr(
        stripe_webhooks.stripe_billing, "retrieve_subscription", _retrieve_subscription
    )

    with caplog.at_level(logging.INFO, logger=DROP_LOGGER):
        notifications = await stripe_webhooks._handle_invoice_paid(
            {
                "id": "in_gate_closed",
                "customer": "cus_gate_closed",
                "status": "paid",
                "paid": True,
                # A renewal, so the period-boundary check passes and this test
                # keeps exercising the grant gate rather than the boundary drop.
                "billing_reason": "subscription_cycle",
                "subscription": "sub_gate_closed" if pro_billing_enabled else None,
                "metadata": {"billing_subject_id": str(subject_id)},
                "lines": {"data": [{"id": "il_gate_closed", "price": {"id": line_price_id}}]},
            },
            event_id="evt_gate_closed",
        )

    assert notifications == ()  # Zero behavior change: still no grant.
    assert await _grants(db_session, subject_id) == []

    level = logging.ERROR if pro_billing_enabled else logging.INFO
    record = _assert_drop_logged(
        caplog,
        drop_reason=DropReason.INVOICE_GRANT_GATE_CLOSED,
        event_id="evt_gate_closed",
        level=level,
    )
    assert record.pro_pricing_enabled is pro_billing_enabled  # type: ignore[attr-defined]
    assert len(paged) == (1 if pro_billing_enabled else 0)
    if pro_billing_enabled:
        assert record.has_subscription_record is True  # type: ignore[attr-defined]
        assert record.has_period_start is False  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_dropped_event_is_still_marked_processed(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    paged: list[dict[str, object]],
) -> None:
    """The disclosed gap: a reported drop keeps the ``processed`` receipt, so
    the event stays unreplayable. A distinct ``ignored`` state is deferred."""
    _use_test_engine(monkeypatch, test_engine)
    secret = "whsec_test_secret"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")

    payload = json.dumps(
        {
            "id": "evt_dropped_still_processed",
            "type": "invoice.paid",
            "data": {
                "object": {
                    "id": "in_dropped_still_processed",
                    "customer": "cus_unknown_to_us",
                    "status": "paid",
                    "paid": True,
                    "lines": {"data": [{"id": "il_other", "price": {"id": "price_unrelated"}}]},
                }
            },
        },
        separators=(",", ":"),
    ).encode("utf-8")

    with caplog.at_level(logging.INFO, logger=DROP_LOGGER):
        ack = await stripe_webhooks.handle_stripe_webhook(
            payload=payload,
            signature_header=_stripe_signature(payload, secret=secret),
        )

    assert ack.event_id == "evt_dropped_still_processed"
    receipt = (
        await db_session.execute(
            select(WebhookEventReceipt).where(
                WebhookEventReceipt.event_id == "evt_dropped_still_processed"
            )
        )
    ).scalar_one()
    assert receipt.status == "processed"

    _assert_drop_logged(
        caplog,
        drop_reason=DropReason.INVOICE_NO_CLOUD_LINE,
        event_id="evt_dropped_still_processed",
        level=logging.ERROR,
    )
    assert len(paged) == 1
