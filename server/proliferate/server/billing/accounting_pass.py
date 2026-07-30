"""Billing accounting pass orchestration."""

from __future__ import annotations

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_OVERAGE_EXPORT,
    BILLING_DECISION_REASON_OVERAGE_CAP_REACHED,
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
)
from proliferate.db import session_ops as db_session
from proliferate.db.store.billing_accounting import (
    list_billing_subject_ids_for_usage_accounting,
    over_cap_receipt_is_current,
)
from proliferate.db.store.billing_runtime_usage import record_billing_decision_event
from proliferate.server.billing import accounting as billing_accounting_service
from proliferate.server.billing import snapshot_state
from proliferate.server.billing import snapshots as billing_snapshots
from proliferate.server.billing.models import utcnow


def _accounting_receipt_reason(*, exported_any: bool) -> str:
    """Reason for the pass's ``overage_export`` receipt.

    A pass that exported nothing and only hit the org-month cap is receipted as
    ``overage_cap_reached`` so the refused spend is attributable (law A2) without
    claiming a pending/observed export that does not exist.
    """
    if not exported_any:
        return BILLING_DECISION_REASON_OVERAGE_CAP_REACHED
    if settings.cloud_billing_mode == BILLING_MODE_OBSERVE:
        return BILLING_USAGE_EXPORT_STATUS_OBSERVED
    return "pending"


async def run_billing_accounting_pass(*, subject_limit: int = 100) -> None:
    if settings.cloud_billing_mode not in {BILLING_MODE_OBSERVE, BILLING_MODE_ENFORCE}:
        return

    await billing_accounting_service.process_pending_seat_adjustments()

    async with db_session.open_async_transaction() as db:
        subject_ids = await list_billing_subject_ids_for_usage_accounting(
            db,
            limit=subject_limit,
        )
    for billing_subject_id in subject_ids:
        async with db_session.open_async_transaction() as db:
            state = await snapshot_state.load_snapshot_state_for_subject(db, billing_subject_id)
            state = await billing_snapshots.state_with_overage_usage(db, state)
        now = utcnow()
        unlimited_state = billing_snapshots.compute_unlimited_cloud_hours_state_for_settings(
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
                and billing_snapshots.subscription_is_pro_for_settings(
                    unlimited_state.subscription,
                )
            )
            else None
        )
        if unlimited_state.has_unlimited_cloud_hours:
            if unlimited_state.unlimited_window_start is not None:
                results.append(
                    await billing_accounting_service.account_usage_for_snapshot_state(
                        state,
                        scan_until=unlimited_state.unlimited_window_start,
                        consume_grants=True,
                        subscription=None,
                    )
                )
            results.append(
                await billing_accounting_service.account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=False,
                    subscription=None,
                )
            )
        elif pro_subscription is not None:
            results.append(
                await billing_accounting_service.account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=True,
                    subscription=pro_subscription,
                )
            )
        else:
            results.append(
                await billing_accounting_service.account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=True,
                    subscription=None,
                )
            )

        exported_any = any(result.export_count > 0 for result in results)
        # Law A2: an entirely over-cap pass exports nothing, so gating the
        # receipt on export_count alone left that spend with no durable trace.
        # Receipt it too, and say which case it was.
        over_cap_cents = sum(result.over_cap_cents for result in results)
        cap_only_refusal = over_cap_cents > 0 and not exported_any
        if cap_only_refusal:
            # An open segment re-refuses spend on every 15-minute pass while the
            # subject sits at the cap, so only the leading edge of a refusal run
            # is receipted (see ``over_cap_receipt_is_current``). Re-arm is a new
            # export row (a cap raise lets a slice through) or a period rollover
            # — a grant refill alone writes no export row, so grant-covered
            # recovery does NOT reopen the next refusal for receipting.
            async with db_session.open_async_transaction() as db:
                if await over_cap_receipt_is_current(
                    db,
                    billing_subject_id=billing_subject_id,
                    period_start=(
                        pro_subscription.current_period_start
                        if pro_subscription is not None
                        else None
                    ),
                ):
                    continue
        if exported_any or over_cap_cents > 0:
            # Known limit (pre-existing, shared with the export receipt): this
            # runs in a SEPARATE transaction from the accounting commit above, so
            # a crash in between loses the receipt permanently — the usage cursor
            # has already advanced and the next pass computes over_cap_cents == 0.
            # Closing it means moving the receipt into the accounting
            # transaction; not done here.
            snapshot = billing_snapshots.build_billing_snapshot(state)
            async with db_session.open_async_transaction() as db:
                await record_billing_decision_event(
                    db,
                    billing_subject_id=billing_subject_id,
                    actor_user_id=None,
                    workspace_id=None,
                    decision_type=BILLING_DECISION_OVERAGE_EXPORT,
                    mode=settings.cloud_billing_mode,
                    # The pre-existing export receipt keeps its False/False: an
                    # export is not a gate decision. A cap refusal is, and the
                    # snapshot is already built here, so report what the gate
                    # actually says about this subject rather than a placeholder.
                    would_block_start=(cap_only_refusal and snapshot.start_blocked),
                    would_pause_active=(cap_only_refusal and snapshot.active_spend_hold),
                    reason=_accounting_receipt_reason(exported_any=exported_any),
                    # Known limit: this pass iterates SUBJECTS, not actors, so an
                    # org subject's snapshot has no user to resolve the per-user
                    # counts through and this reads 0 (W-F1). Cosmetic here — the
                    # receipt's decision fields come from grants and the cap, which
                    # are per-subject — but it is not a measured zero. The
                    # reconciler's enforce receipts pass the segment's actor.
                    active_sandbox_count=snapshot.active_sandbox_count,
                    remaining_seconds=snapshot.remaining_seconds,
                    # Attribution (law A2): how much metered spend this pass
                    # refused, including on a partial clamp where the receipt
                    # reads as an ordinary export. A pass that refused nothing
                    # leaves it NULL rather than claiming a measured zero.
                    # Records the first refusal's amount for the standing
                    # condition, not a running total: once the receipt is
                    # current (see ``over_cap_receipt_is_current``), subsequent
                    # passes in the same refusal run are deduped and never reach
                    # this line, so their refused amounts are not accumulated
                    # here.
                    refused_cents=(over_cap_cents if over_cap_cents > 0 else None),
                )

    if settings.cloud_billing_mode == BILLING_MODE_ENFORCE:
        await billing_accounting_service.send_pending_usage_exports()
