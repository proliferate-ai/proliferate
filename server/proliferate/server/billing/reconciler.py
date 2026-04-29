"""Background billing reconciliation and quota enforcement."""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from uuid import UUID

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_ENFORCE_ACTIVE_SPEND,
    BILLING_MODE_ENFORCE,
    BILLING_RECONCILE_INTERVAL_SECONDS,
    USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
    USAGE_SEGMENT_CLOSED_BY_RECONCILER,
    USAGE_SEGMENT_OPENED_BY_RECONCILER_REPAIR,
)
from proliferate.db.models.billing import UsageSegment
from proliferate.db.store.billing import (
    close_usage_segment_for_sandbox,
    list_all_open_usage_segments,
    open_usage_segment_for_sandbox,
    record_billing_decision_event,
    with_billing_reconciler_lock,
)
from proliferate.db.store.cloud_workspaces import (
    load_cloud_sandbox_by_id,
    load_cloud_sandbox_placeholders,
    load_cloud_workspace_by_id,
    persist_workspace_destroy_state,
    persist_workspace_stop_state,
    save_sandbox_provider_state,
)
from proliferate.integrations.sandbox import ProviderSandboxState, get_configured_sandbox_provider
from proliferate.integrations.sentry import capture_server_sentry_exception
from proliferate.server.billing.models import BillingSnapshot
from proliferate.server.billing.service import get_billing_snapshot_for_subject
from proliferate.utils.time import utcnow

logger = logging.getLogger("proliferate.billing.reconciler")

_reconciler_task: asyncio.Task[None] | None = None


def _is_running_state(state: str) -> bool:
    return state in {"running", "started"}


async def _mark_workspace_stopped(workspace_id: UUID, *, destroyed: bool) -> None:
    workspace = await load_cloud_workspace_by_id(workspace_id)
    if workspace is None:
        return
    workspace.status = "stopped"
    workspace.status_detail = "Stopped"
    if destroyed:
        await persist_workspace_destroy_state(workspace)
    else:
        await persist_workspace_stop_state(workspace)


async def _repair_placeholders(
    *,
    states_by_placeholder_id: dict[str, ProviderSandboxState],
) -> None:
    placeholders = await load_cloud_sandbox_placeholders()
    for placeholder in placeholders:
        state = states_by_placeholder_id.get(str(placeholder.id))
        if state is None:
            continue
        workspace = await load_cloud_workspace_by_id(placeholder.cloud_workspace_id)
        if workspace is None:
            continue
        await save_sandbox_provider_state(
            placeholder.id,
            external_sandbox_id=state.external_sandbox_id,
            status="running" if _is_running_state(state.state) else state.state,
            started_at=state.started_at,
        )
        if _is_running_state(state.state):
            await open_usage_segment_for_sandbox(
                user_id=workspace.user_id,
                workspace_id=placeholder.cloud_workspace_id,
                sandbox_id=placeholder.id,
                external_sandbox_id=state.external_sandbox_id,
                sandbox_execution_id=None,
                started_at=state.started_at or state.observed_at,
                opened_by=USAGE_SEGMENT_OPENED_BY_RECONCILER_REPAIR,
            )


async def _enforce_or_reconcile_segment(
    *,
    segment: UsageSegment,
    state: ProviderSandboxState | None,
    billing_snapshot: BillingSnapshot,
    record_hold_decision: bool,
) -> bool:
    sandbox = await load_cloud_sandbox_by_id(segment.sandbox_id)
    if sandbox is None:
        return False

    if state is None or state.state in {"paused", "stopped"}:
        await close_usage_segment_for_sandbox(
            sandbox_id=sandbox.id,
            ended_at=(state.end_at or state.observed_at) if state is not None else utcnow(),
            closed_by=USAGE_SEGMENT_CLOSED_BY_RECONCILER,
        )
        await save_sandbox_provider_state(
            sandbox.id,
            status="paused",
            stopped_at=(state.end_at or state.observed_at) if state is not None else utcnow(),
        )
        await _mark_workspace_stopped(sandbox.cloud_workspace_id, destroyed=False)
        return False

    if state.state in {"killed", "destroyed", "terminated"}:
        await close_usage_segment_for_sandbox(
            sandbox_id=sandbox.id,
            ended_at=state.end_at or state.observed_at,
            closed_by=USAGE_SEGMENT_CLOSED_BY_RECONCILER,
        )
        await save_sandbox_provider_state(
            sandbox.id,
            status="destroyed",
            stopped_at=state.end_at or state.observed_at,
        )
        await _mark_workspace_stopped(sandbox.cloud_workspace_id, destroyed=True)
        return False

    hold_decision_recorded = False
    if record_hold_decision and billing_snapshot.active_spend_hold:
        await record_billing_decision_event(
            billing_subject_id=billing_snapshot.billing_subject_id,
            actor_user_id=segment.user_id,
            workspace_id=segment.workspace_id,
            decision_type=BILLING_DECISION_ENFORCE_ACTIVE_SPEND,
            mode=settings.cloud_billing_mode,
            would_block_start=billing_snapshot.start_blocked,
            would_pause_active=True,
            reason=billing_snapshot.hold_reason,
            active_sandbox_count=billing_snapshot.active_sandbox_count,
            remaining_seconds=billing_snapshot.remaining_seconds,
        )
        hold_decision_recorded = True
    if settings.cloud_billing_mode == BILLING_MODE_ENFORCE and billing_snapshot.active_spend_hold:
        provider = get_configured_sandbox_provider()
        if sandbox.external_sandbox_id:
            try:
                await provider.pause_sandbox(sandbox.external_sandbox_id)
            except Exception:
                logger.exception(
                    "billing enforcement failed to pause sandbox",
                    extra={
                        "sandbox_id": str(sandbox.id),
                        "external_sandbox_id": sandbox.external_sandbox_id,
                    },
                )
                return hold_decision_recorded
        ended_at = utcnow()
        await close_usage_segment_for_sandbox(
            sandbox_id=sandbox.id,
            ended_at=ended_at,
            closed_by=USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
        )
        await save_sandbox_provider_state(
            sandbox.id,
            status="paused",
            stopped_at=ended_at,
        )
        await _mark_workspace_stopped(sandbox.cloud_workspace_id, destroyed=False)
    return hold_decision_recorded


async def run_billing_reconcile_pass() -> None:
    async def _run(_db: object) -> None:
        provider = get_configured_sandbox_provider()
        states = await provider.list_sandbox_states()
        states_by_external_id = {state.external_sandbox_id: state for state in states}
        states_by_placeholder_id = {
            state.metadata["cloud_sandbox_id"]: state
            for state in states
            if state.metadata.get("cloud_sandbox_id")
        }

        await _repair_placeholders(states_by_placeholder_id=states_by_placeholder_id)

        snapshots_by_subject: dict[UUID, BillingSnapshot] = {}
        recorded_hold_decision_subjects: set[UUID] = set()
        open_segments = await list_all_open_usage_segments()
        for segment in open_segments:
            billing_snapshot = snapshots_by_subject.get(segment.billing_subject_id)
            if billing_snapshot is None:
                billing_snapshot = await get_billing_snapshot_for_subject(
                    segment.billing_subject_id
                )
                snapshots_by_subject[segment.billing_subject_id] = billing_snapshot
            hold_decision_recorded = await _enforce_or_reconcile_segment(
                segment=segment,
                state=(
                    states_by_external_id.get(segment.external_sandbox_id)
                    if segment.external_sandbox_id
                    else None
                ),
                billing_snapshot=billing_snapshot,
                record_hold_decision=(
                    segment.billing_subject_id not in recorded_hold_decision_subjects
                ),
            )
            if hold_decision_recorded:
                recorded_hold_decision_subjects.add(segment.billing_subject_id)

    acquired, _ = await with_billing_reconciler_lock(_run)
    if not acquired:
        logger.debug("billing reconciler skipped because another instance owns the lock")


async def _billing_reconciler_loop() -> None:
    while True:
        try:
            await run_billing_reconcile_pass()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            capture_server_sentry_exception(
                exc,
                tags={
                    "domain": "billing",
                    "action": "reconcile_loop",
                },
            )
            logger.exception("billing reconciler pass failed")
        await asyncio.sleep(max(BILLING_RECONCILE_INTERVAL_SECONDS, 30))


def start_billing_reconciler() -> None:
    global _reconciler_task
    if _reconciler_task is not None and not _reconciler_task.done():
        return
    _reconciler_task = asyncio.create_task(_billing_reconciler_loop())


async def stop_billing_reconciler() -> None:
    global _reconciler_task
    if _reconciler_task is None:
        return
    _reconciler_task.cancel()
    with suppress(asyncio.CancelledError):
        await _reconciler_task
    _reconciler_task = None
