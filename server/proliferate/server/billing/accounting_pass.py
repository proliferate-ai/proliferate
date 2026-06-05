"""Billing accounting pass orchestration."""

from __future__ import annotations

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_OVERAGE_EXPORT,
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
)
from proliferate.db import session_ops as db_session
from proliferate.db.store.billing_accounting import (
    list_billing_subject_ids_for_usage_accounting,
)
from proliferate.db.store.billing_runtime_usage import record_billing_decision_event
from proliferate.server.billing import accounting as billing_accounting_service
from proliferate.server.billing import snapshot_state
from proliferate.server.billing import snapshots as billing_snapshots
from proliferate.server.billing.models import utcnow


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

        if any(result.export_count > 0 for result in results):
            snapshot = billing_snapshots.build_billing_snapshot(state)
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
                    reason=(
                        BILLING_USAGE_EXPORT_STATUS_OBSERVED
                        if settings.cloud_billing_mode == BILLING_MODE_OBSERVE
                        else "pending"
                    ),
                    active_sandbox_count=snapshot.active_sandbox_count,
                    remaining_seconds=snapshot.remaining_seconds,
                )

    if settings.cloud_billing_mode == BILLING_MODE_ENFORCE:
        await billing_accounting_service.send_pending_usage_exports()
