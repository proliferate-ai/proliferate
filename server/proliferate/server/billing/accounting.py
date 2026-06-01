"""Billing usage accounting orchestration."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_OVERAGE_EXPORT,
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    BILLING_USAGE_EXPORT_STATUS_PENDING,
    BILLING_USAGE_EXPORT_STATUS_WRITTEN_OFF,
    PRO_DEFAULT_OVERAGE_CAP_CENTS_PER_SEAT,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.billing import BillingSubscription
from proliferate.db.store.billing import (
    BillingAccountingResult,
    BillingSnapshotState,
    ClaimedUsageExport,
    acquire_billing_subject_accounting_lock,
    create_usage_export,
    get_billing_snapshot_state_for_subject,
    get_billing_subject_by_id,
    get_or_create_overage_remainder,
    list_accountable_usage_ranges,
    list_billing_subject_ids_for_usage_accounting,
    list_grants_for_update,
    record_billing_decision_event,
    record_grant_consumption,
    sum_meter_quantity_cents_for_subject,
    upsert_usage_cursor,
)
from proliferate.db.store.billing import (
    claim_usage_exports_for_sending as claim_usage_exports_for_sending_record,
)
from proliferate.server.billing.domain.accounting import (
    active_pro_period_start,
    next_accounting_boundary,
    ordered_accounting_grants,
    overage_seconds_to_cents,
    usage_export_idempotency_key,
)
from proliferate.server.billing.models import coerce_utc, utcnow
from proliferate.server.billing.pricing import billing_price_ids_from_settings


async def state_with_overage_usage(
    db: AsyncSession,
    state: BillingSnapshotState,
) -> BillingSnapshotState:
    active_period_start = active_pro_period_start(
        state.subscriptions,
        now=utcnow(),
        price_ids=billing_price_ids_from_settings(),
    )
    if active_period_start is None:
        return state
    return replace(
        state,
        managed_cloud_overage_used_cents=await sum_meter_quantity_cents_for_subject(
            db,
            state.billing_subject_id,
            period_start=active_period_start,
        ),
    )


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

    async with db_engine.async_session_factory() as db, db.begin():
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
    async with db_engine.async_session_factory() as db, db.begin():
        return await claim_usage_exports_for_sending_record(db, limit=limit)


async def _account_usage_for_snapshot_state(
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


async def run_billing_accounting_pass(*, subject_limit: int = 100) -> None:
    from proliferate.server.billing.service import (
        _build_billing_snapshot,
        _compute_unlimited_cloud_hours_state,
        _subscription_is_pro,
        process_pending_seat_adjustments,
        send_pending_usage_exports,
    )

    if settings.cloud_billing_mode not in {BILLING_MODE_OBSERVE, BILLING_MODE_ENFORCE}:
        return

    await process_pending_seat_adjustments()

    async with db_engine.async_session_factory() as db, db.begin():
        subject_ids = await list_billing_subject_ids_for_usage_accounting(
            db,
            limit=subject_limit,
        )
    for billing_subject_id in subject_ids:
        async with db_engine.async_session_factory() as db, db.begin():
            state = await get_billing_snapshot_state_for_subject(db, billing_subject_id)
            state = await state_with_overage_usage(db, state)
        now = utcnow()
        unlimited_state = _compute_unlimited_cloud_hours_state(
            subscriptions=state.subscriptions,
            entitlements=state.entitlements,
            now=now,
        )
        results = []
        pro_subscription = (
            unlimited_state.subscription
            if (
                settings.pro_billing_enabled
                and unlimited_state.subscription is not None
                and _subscription_is_pro(unlimited_state.subscription)
            )
            else None
        )
        if unlimited_state.has_unlimited_cloud_hours:
            if unlimited_state.unlimited_window_start is not None:
                results.append(
                    await _account_usage_for_snapshot_state(
                        state,
                        scan_until=unlimited_state.unlimited_window_start,
                        consume_grants=True,
                        subscription=None,
                    )
                )
            results.append(
                await _account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=False,
                    subscription=None,
                )
            )
        elif pro_subscription is not None:
            results.append(
                await _account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=True,
                    subscription=pro_subscription,
                )
            )
        else:
            results.append(
                await _account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=True,
                    subscription=None,
                )
            )

        if any(result.export_count > 0 for result in results):
            snapshot = _build_billing_snapshot(state)
            async with db_engine.async_session_factory() as db, db.begin():
                await record_billing_decision_event(
                    db,
                    billing_subject_id=billing_subject_id,
                    actor_user_id=None,
                    workspace_id=None,
                    decision_type=BILLING_DECISION_OVERAGE_EXPORT,
                    mode=settings.cloud_billing_mode,
                    would_block_start=False,
                    would_pause_active=False,
                    reason=(
                        BILLING_USAGE_EXPORT_STATUS_OBSERVED
                        if settings.cloud_billing_mode == BILLING_MODE_OBSERVE
                        else "pending"
                    ),
                    active_sandbox_count=snapshot.active_sandbox_count,
                    remaining_seconds=snapshot.remaining_seconds,
                )

    if settings.cloud_billing_mode == BILLING_MODE_ENFORCE:
        await send_pending_usage_exports()


__all__ = [
    "account_usage_for_billing_subject",
    "claim_usage_exports_for_sending",
    "overage_seconds_to_cents",
    "run_billing_accounting_pass",
    "state_with_overage_usage",
]
