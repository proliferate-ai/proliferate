"""Billing usage accounting service routines."""

from __future__ import annotations

import logging
import math
from datetime import datetime
from uuid import UUID

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_OVERAGE_EXPORT,
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_MODE_OFF,
    BILLING_USAGE_EXPORT_STATUS_FAILED_TERMINAL,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    BILLING_USAGE_EXPORT_STATUS_PENDING,
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
    BILLING_USAGE_EXPORT_STATUS_WRITTEN_OFF,
    PRO_DEFAULT_OVERAGE_CAP_CENTS_PER_SEAT,
    PRO_SEAT_PRORATION_GRANT_TYPE,
)
from proliferate.db import session_ops as db_session
from proliferate.db.models.billing import BillingSubscription
from proliferate.db.store import billing_seats
from proliferate.db.store.billing import sum_meter_quantity_cents_for_subject
from proliferate.db.store.billing_accounting import (
    BillingAccountingResult,
    ClaimedUsageExport,
    acquire_billing_subject_accounting_lock,
    create_usage_export,
    get_or_create_overage_remainder,
    list_accountable_usage_ranges,
    list_grants_for_update,
    mark_usage_export_failed,
    mark_usage_export_succeeded,
    record_grant_consumption,
    upsert_usage_cursor,
)
from proliferate.db.store.billing_accounting import (
    claim_usage_exports_for_sending as claim_usage_exports_for_sending_record,
)
from proliferate.db.store.billing_runtime_usage import record_billing_decision_event
from proliferate.db.store.billing_subjects import (
    ensure_billing_grant_record,
    get_billing_subject_by_id,
)
from proliferate.integrations import stripe as stripe_billing
from proliferate.server.billing.domain.accounting import (
    next_accounting_boundary,
    ordered_accounting_grants,
    overage_seconds_to_cents,
    stripe_status_is_terminal,
    terminal_meter_event_error,
    usage_export_idempotency_key,
    usage_export_identifier,
)
from proliferate.server.billing.models import coerce_utc, utcnow
from proliferate.server.billing.pricing import configured_managed_cloud_meter_event_name
from proliferate.server.billing.seats import (
    prorated_seat_grant_hours,
    seat_proration_grant_source_ref,
)
from proliferate.server.billing.snapshot_state import BillingSnapshotState

logger = logging.getLogger("proliferate.billing.accounting")


async def account_usage_for_billing_subject(
    *,
    billing_subject_id: UUID,
    is_paid_cloud: bool,
    billing_subscription_id: UUID | None,
    period_start: datetime | None,
    period_end: datetime | None,
    overage_enabled: bool,
    billing_mode: str,
    overage_cap_cents: int | None = None,
    consume_grants: bool = True,
    export_overage: bool = True,
    scan_until: datetime | None = None,
) -> BillingAccountingResult:
    if billing_mode not in {BILLING_MODE_OBSERVE, BILLING_MODE_ENFORCE}:
        return BillingAccountingResult(
            billing_subject_id=billing_subject_id,
            consumed_seconds=0.0,
            export_seconds=0.0,
            export_count=0,
        )

    now = utcnow()
    effective_scan_until = coerce_utc(scan_until) or now
    period_start_utc = coerce_utc(period_start)
    period_end_utc = coerce_utc(period_end)
    if is_paid_cloud and period_end_utc is not None:
        effective_scan_until = min(effective_scan_until, period_end_utc)
    if effective_scan_until > now:
        effective_scan_until = now

    async with db_session.open_async_transaction() as db:
        await acquire_billing_subject_accounting_lock(db, billing_subject_id)
        subject = await get_billing_subject_by_id(db, billing_subject_id)
        if subject is None:
            return BillingAccountingResult(
                billing_subject_id=billing_subject_id,
                consumed_seconds=0.0,
                export_seconds=0.0,
                export_count=0,
            )

        grants = await list_grants_for_update(db, billing_subject_id)
        usage_ranges = await list_accountable_usage_ranges(
            db,
            billing_subject_id=billing_subject_id,
            scan_until=effective_scan_until,
        )

        consumed_seconds = 0.0
        export_seconds = 0.0
        export_count = 0
        export_status = (
            BILLING_USAGE_EXPORT_STATUS_OBSERVED
            if billing_mode == BILLING_MODE_OBSERVE
            else BILLING_USAGE_EXPORT_STATUS_PENDING
        )
        can_export_overage = export_overage and is_paid_cloud and overage_enabled
        accounting_boundaries = (
            (period_start_utc,) if is_paid_cloud and period_start_utc is not None else ()
        )
        cap_used_cents = 0
        overage_remainder = None
        if can_export_overage and period_start_utc is not None:
            cap_used_cents = await sum_meter_quantity_cents_for_subject(
                db,
                billing_subject_id,
                period_start=period_start_utc,
            )
            overage_remainder = await get_or_create_overage_remainder(
                db,
                billing_subject_id=billing_subject_id,
                billing_subscription_id=billing_subscription_id,
                period_start=period_start_utc,
            )

        for segment, range_start, range_end in usage_ranges:
            accounted_from = range_start
            while accounted_from < range_end:
                accounted_until = next_accounting_boundary(
                    accounted_from,
                    range_end,
                    grants if consume_grants else [],
                    accounting_boundaries,
                )
                seconds = max((accounted_until - accounted_from).total_seconds(), 0.0)
                if seconds <= 0:
                    break

                uncovered_seconds = seconds
                if consume_grants:
                    for grant in ordered_accounting_grants(
                        grants,
                        pro_billing_enabled=settings.pro_billing_enabled,
                        is_paid_cloud=is_paid_cloud,
                        at=accounted_from,
                    ):
                        consumed = min(float(grant.remaining_seconds), uncovered_seconds)
                        if consumed <= 0:
                            continue
                        grant.remaining_seconds = max(
                            float(grant.remaining_seconds) - consumed,
                            0.0,
                        )
                        grant.updated_at = now
                        await record_grant_consumption(
                            db,
                            billing_subject_id=billing_subject_id,
                            billing_grant_id=grant.id,
                            usage_segment_id=segment.id,
                            accounted_from=accounted_from,
                            accounted_until=accounted_until,
                            seconds=consumed,
                            source="usage_accounting",
                        )
                        consumed_seconds += consumed
                        uncovered_seconds -= consumed
                        if uncovered_seconds <= 0:
                            break

                slice_is_in_paid_period = (
                    period_start_utc is None or accounted_from >= period_start_utc
                )
                if uncovered_seconds > 0 and can_export_overage and slice_is_in_paid_period:
                    remainder_cents = (
                        float(overage_remainder.fractional_cents)
                        if overage_remainder is not None
                        else 0.0
                    )
                    meter_cents, fractional_cents = overage_seconds_to_cents(
                        uncovered_seconds,
                        fractional_cents=remainder_cents,
                    )
                    if overage_remainder is not None:
                        overage_remainder.fractional_cents = fractional_cents
                        overage_remainder.updated_at = now

                    if meter_cents > 0:
                        cap_remaining_cents = (
                            max(overage_cap_cents - cap_used_cents, 0)
                            if overage_cap_cents is not None
                            else meter_cents
                        )
                        billable_cents = min(meter_cents, cap_remaining_cents)
                        writeoff_cents = max(meter_cents - billable_cents, 0)
                        base_idempotency_key = usage_export_idempotency_key(
                            billing_subject_id=billing_subject_id,
                            usage_segment_id=segment.id,
                            accounted_from=accounted_from,
                            accounted_until=accounted_until,
                        )
                        billable_seconds = (
                            uncovered_seconds * billable_cents / meter_cents
                            if billable_cents > 0
                            else 0.0
                        )
                        writeoff_seconds = max(uncovered_seconds - billable_seconds, 0.0)
                        if billable_cents > 0:
                            await create_usage_export(
                                db,
                                billing_subject_id=billing_subject_id,
                                billing_subscription_id=billing_subscription_id,
                                usage_segment_id=segment.id,
                                period_start=period_start,
                                period_end=period_end,
                                accounted_from=accounted_from,
                                accounted_until=accounted_until,
                                quantity_seconds=billable_seconds,
                                meter_quantity_cents=billable_cents,
                                cap_cents_snapshot=overage_cap_cents,
                                cap_used_cents_snapshot=cap_used_cents,
                                idempotency_key=f"{base_idempotency_key}:billable",
                                status=export_status,
                            )
                            cap_used_cents += billable_cents
                            export_seconds += billable_seconds
                            export_count += 1
                        if writeoff_cents > 0:
                            await create_usage_export(
                                db,
                                billing_subject_id=billing_subject_id,
                                billing_subscription_id=billing_subscription_id,
                                usage_segment_id=segment.id,
                                period_start=period_start,
                                period_end=period_end,
                                accounted_from=accounted_from,
                                accounted_until=accounted_until,
                                quantity_seconds=writeoff_seconds,
                                meter_quantity_cents=0,
                                cap_cents_snapshot=overage_cap_cents,
                                cap_used_cents_snapshot=cap_used_cents,
                                writeoff_reason="overage_cap_exhausted",
                                idempotency_key=f"{base_idempotency_key}:writeoff",
                                status=BILLING_USAGE_EXPORT_STATUS_WRITTEN_OFF,
                            )
                            export_count += 1

                await upsert_usage_cursor(
                    db,
                    billing_subject_id=billing_subject_id,
                    usage_segment_id=segment.id,
                    accounted_until=accounted_until,
                )
                accounted_from = accounted_until

        return BillingAccountingResult(
            billing_subject_id=billing_subject_id,
            consumed_seconds=consumed_seconds,
            export_seconds=export_seconds,
            export_count=export_count,
        )


async def claim_usage_exports_for_sending(*, limit: int = 100) -> list[ClaimedUsageExport]:
    async with db_session.open_async_transaction() as db:
        return await claim_usage_exports_for_sending_record(db, limit=limit)


async def account_usage_for_snapshot_state(
    state: BillingSnapshotState,
    *,
    scan_until: datetime,
    consume_grants: bool,
    subscription: BillingSubscription | None,
) -> BillingAccountingResult:
    return await account_usage_for_billing_subject(
        billing_subject_id=state.billing_subject_id,
        is_paid_cloud=subscription is not None,
        billing_subscription_id=subscription.id if subscription is not None else None,
        period_start=subscription.current_period_start if subscription is not None else None,
        period_end=subscription.current_period_end if subscription is not None else None,
        overage_enabled=state.subject.overage_enabled if subscription is not None else False,
        overage_cap_cents=(
            max(state.active_seat_count, 1)
            * int(
                state.subject.overage_cap_cents_per_seat
                if state.subject.overage_cap_cents_per_seat is not None
                else PRO_DEFAULT_OVERAGE_CAP_CENTS_PER_SEAT
            )
            if subscription is not None and settings.pro_billing_enabled
            else None
        ),
        billing_mode=settings.cloud_billing_mode,
        consume_grants=consume_grants,
        export_overage=subscription is not None and settings.pro_billing_enabled,
        scan_until=scan_until,
    )


async def process_pending_seat_adjustments(*, limit: int = 100) -> None:
    if not settings.pro_billing_enabled or settings.cloud_billing_mode == BILLING_MODE_OFF:
        return

    async with db_session.open_async_transaction() as db:
        adjustments = await billing_seats.claim_pending_seat_adjustments(db, limit=limit)
    for adjustment in adjustments:
        try:
            await stripe_billing.update_subscription_item_quantity(
                subscription_item_id=adjustment.monthly_subscription_item_id,
                quantity=adjustment.target_quantity,
                idempotency_key=f"seat-quantity:{adjustment.id}:seats:{adjustment.target_quantity}",
            )
            async with db_session.open_async_transaction() as db:
                await billing_seats.mark_seat_adjustment_stripe_confirmed(
                    db,
                    adjustment_id=adjustment.id,
                )
            if (
                adjustment.period_start is not None
                and adjustment.period_end is not None
                and adjustment.effective_at is not None
                and adjustment.membership_id is not None
                and adjustment.grant_quantity > 0
            ):
                period_start_unix = int(adjustment.period_start.timestamp())
                grant_source_ref = seat_proration_grant_source_ref(
                    subscription_id=adjustment.stripe_subscription_id,
                    membership_id=str(adjustment.membership_id),
                    period_start_unix=period_start_unix,
                )
                hours_granted = prorated_seat_grant_hours(
                    added_seats=adjustment.grant_quantity,
                    period_start=adjustment.period_start,
                    period_end=adjustment.period_end,
                    effective_at=adjustment.effective_at,
                )
                async with db_session.open_async_transaction() as db:
                    await ensure_billing_grant_record(
                        db,
                        user_id=adjustment.user_id,
                        billing_subject_id=adjustment.billing_subject_id,
                        grant_type=PRO_SEAT_PRORATION_GRANT_TYPE,
                        hours_granted=hours_granted,
                        effective_at=adjustment.effective_at,
                        expires_at=adjustment.period_end,
                        source_ref=grant_source_ref,
                    )
            async with db_session.open_async_transaction() as db:
                await billing_seats.mark_seat_adjustment_grant_issued(
                    db,
                    adjustment_id=adjustment.id,
                )
        except stripe_billing.StripeBillingError as error:
            async with db_session.open_async_transaction() as db:
                await billing_seats.mark_seat_adjustment_failed(
                    db,
                    adjustment_id=adjustment.id,
                    error=error.message,
                    terminal=_stripe_error_is_terminal(error),
                )
        except Exception as error:
            async with db_session.open_async_transaction() as db:
                await billing_seats.mark_seat_adjustment_failed(
                    db,
                    adjustment_id=adjustment.id,
                    error=f"{type(error).__name__}: {error}",
                )


def _stripe_error_is_terminal(error: stripe_billing.StripeBillingError) -> bool:
    return stripe_status_is_terminal(error.status_code)


async def send_pending_usage_exports(*, limit: int = 100) -> None:
    if settings.cloud_billing_mode != BILLING_MODE_ENFORCE:
        return

    async with db_session.open_async_transaction() as db:
        exports = await claim_usage_exports_for_sending_record(db, limit=limit)
    now = utcnow()
    for export in exports:
        terminal_error = _terminal_export_error(export.accounted_until, now=now)
        if not export.stripe_customer_id:
            terminal_error = "Billing subject has no Stripe customer id."
        if terminal_error is not None:
            async with db_session.open_async_transaction() as db:
                await mark_usage_export_failed(
                    db,
                    export_id=export.id,
                    terminal=True,
                    error=terminal_error,
                )
            await _record_usage_export_decision(
                billing_subject_id=export.billing_subject_id,
                reason=BILLING_USAGE_EXPORT_STATUS_FAILED_TERMINAL,
            )
            logger.error(
                "billing usage export failed permanently",
                extra={"billing_usage_export_id": str(export.id), "reason": terminal_error},
            )
            continue

        legacy_seconds_export = export.meter_quantity_cents is None
        quantity = (
            max(1, math.ceil(export.quantity_seconds))
            if legacy_seconds_export
            else max(1, int(export.meter_quantity_cents or 0))
        )
        identifier = usage_export_identifier(export.id)
        try:
            meter_kwargs = {
                "event_name": (
                    settings.stripe_sandbox_meter_event_name
                    if legacy_seconds_export
                    else configured_managed_cloud_meter_event_name()
                ),
                "stripe_customer_id": export.stripe_customer_id,
                "identifier": identifier,
                "timestamp": int((coerce_utc(export.accounted_until) or now).timestamp()),
                "idempotency_key": export.idempotency_key,
            }
            if legacy_seconds_export:
                meter_kwargs["quantity_seconds"] = quantity
            else:
                meter_kwargs["quantity"] = quantity
            payload = await stripe_billing.create_meter_event(**meter_kwargs)
        except stripe_billing.StripeBillingError as error:
            async with db_session.open_async_transaction() as db:
                await mark_usage_export_failed(
                    db,
                    export_id=export.id,
                    terminal=False,
                    error=error.message,
                )
            await _record_usage_export_decision(
                billing_subject_id=export.billing_subject_id,
                reason="failed_retryable",
            )
            logger.warning(
                "billing usage export failed and will be retried",
                extra={"billing_usage_export_id": str(export.id), "error": error.message},
            )
            continue

        meter_identifier = payload.get("identifier")
        async with db_session.open_async_transaction() as db:
            await mark_usage_export_succeeded(
                db,
                export_id=export.id,
                stripe_meter_event_identifier=(
                    meter_identifier if isinstance(meter_identifier, str) else identifier
                ),
            )
        await _record_usage_export_decision(
            billing_subject_id=export.billing_subject_id,
            reason=BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
        )


def _terminal_export_error(accounted_until: datetime, *, now: datetime) -> str | None:
    return terminal_meter_event_error(accounted_until, now=now)


async def _record_usage_export_decision(*, billing_subject_id: UUID, reason: str) -> None:
    async with db_session.open_async_transaction() as db:
        await record_billing_decision_event(
            db,
            billing_subject_id=billing_subject_id,
            actor_user_id=None,
            workspace_id=None,
            decision_type=BILLING_DECISION_OVERAGE_EXPORT,
            mode=settings.cloud_billing_mode,
            would_block_start=False,
            would_pause_active=False,
            reason=reason,
            active_sandbox_count=0,
            remaining_seconds=None,
        )
