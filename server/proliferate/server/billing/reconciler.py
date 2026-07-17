"""Background billing reconciliation and quota enforcement."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_ENFORCE_ACTIVE_SPEND,
    BILLING_DECISION_ORG_LIMIT_PAUSE,
    BILLING_DECISION_USER_LIMIT_PAUSE,
    BILLING_MODE_ENFORCE,
    BILLING_RECONCILE_INTERVAL_SECONDS,
    USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
    USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
    USAGE_SEGMENT_CLOSED_BY_RECONCILER,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.billing import BillingBudgetLimit, UsageSegment
from proliferate.db.store import billing as billing_store
from proliferate.db.store.billing_runtime_usage import (
    close_usage_segment_for_sandbox as close_usage_segment_for_sandbox_record,
)
from proliferate.db.store.billing_runtime_usage import (
    list_all_open_usage_segments as list_all_open_usage_segments_record,
)
from proliferate.db.store.billing_runtime_usage import (
    record_billing_decision_event as record_billing_decision_event_record,
)
from proliferate.db.store.billing_runtime_usage import (
    release_billing_reconciler_lock,
    try_acquire_billing_reconciler_lock,
)
from proliferate.db.store.cloud_sandboxes import (
    load_cloud_sandbox_by_id,
    mark_cloud_sandbox_provider_missing,
    mark_cloud_sandbox_provider_state,
)
from proliferate.integrations.sandbox import (
    ProviderSandboxState,
    SandboxProvider,
    get_configured_sandbox_provider,
)
from proliferate.integrations.sentry import report_critical
from proliferate.server.billing.accounting_pass import run_billing_accounting_pass
from proliferate.server.billing.budget_limits import window_bounds
from proliferate.server.billing.models import BillingSnapshot
from proliferate.server.billing.snapshots import get_billing_snapshot_for_subject
from proliferate.server.cloud.materialization.failures import (
    PROVIDER_SANDBOX_MISSING_RECEIPT,
)
from proliferate.utils.time import utcnow

logger = logging.getLogger("proliferate.billing.reconciler")

_reconciler_task: asyncio.Task[None] | None = None


async def list_all_open_usage_segments() -> list[UsageSegment]:
    async with db_engine.async_session_factory() as db:
        return await list_all_open_usage_segments_record(db)


async def record_billing_decision_event(
    *,
    billing_subject_id: UUID,
    actor_user_id: UUID | None,
    workspace_id: UUID | None,
    decision_type: str,
    mode: str,
    would_block_start: bool,
    would_pause_active: bool,
    reason: str | None,
    active_sandbox_count: int,
    remaining_seconds: float | None,
) -> None:
    async with db_engine.async_session_factory() as db, db.begin():
        await record_billing_decision_event_record(
            db,
            billing_subject_id=billing_subject_id,
            actor_user_id=actor_user_id,
            workspace_id=workspace_id,
            decision_type=decision_type,
            mode=mode,
            would_block_start=would_block_start,
            would_pause_active=would_pause_active,
            reason=reason,
            active_sandbox_count=active_sandbox_count,
            remaining_seconds=remaining_seconds,
        )


async def with_billing_reconciler_lock[T](
    callback: Callable[[AsyncSession], Awaitable[T]],
) -> tuple[bool, T | None]:
    async with db_engine.async_session_factory() as db:
        acquired = await try_acquire_billing_reconciler_lock(db)
        if not acquired:
            return False, None
        try:
            result = await callback(db)
            await db.commit()
            return True, result
        except Exception:
            await db.rollback()
            raise
        finally:
            await release_billing_reconciler_lock(db)


async def _mark_sandbox_environment_unavailable(
    sandbox_id: UUID,
    *,
    destroyed: bool,
    expected_provider_sandbox_id: str,
    expected_status: str,
    ended_at: datetime,
    closed_by: str,
) -> bool:
    """Reflect a reconciler stop into the ``cloud_sandbox`` row.

    The old runtime-environment tables are gone (#823 cutover); the surviving
    ``CloudSandbox`` carries the lifecycle status directly. Provider death is
    recoverable and must not masquerade as explicit product deletion.
    """
    async with db_engine.async_session_factory() as db, db.begin():
        if destroyed:
            updated = await mark_cloud_sandbox_provider_missing(
                db,
                sandbox_id,
                expected_provider_sandbox_id=expected_provider_sandbox_id,
                last_error=PROVIDER_SANDBOX_MISSING_RECEIPT,
            )
            if updated is None:
                # Explicit deletion may have won after reconciliation loaded
                # the row. Preserve product-owned destroyed state, but still
                # close usage when that historical row retains this exact
                # provider binding. A replacement or missing row stays inert.
                current = await load_cloud_sandbox_by_id(
                    db,
                    sandbox_id,
                    lock_row=True,
                    refresh=True,
                )
                if (
                    current is None
                    or current.destroyed_at is None
                    or current.e2b_sandbox_id != expected_provider_sandbox_id
                ):
                    return False
        else:
            # Preserve a terminal materialization receipt while still ending
            # exact provider usage for an observed pause/stop.
            updated = await mark_cloud_sandbox_provider_state(
                db,
                sandbox_id,
                status="error" if expected_status == "error" else "paused",
                expected_provider_sandbox_id=expected_provider_sandbox_id,
                expected_status=expected_status,
            )
        if not destroyed and updated is None:
            return False
        await close_usage_segment_for_sandbox_record(
            db,
            sandbox_id=sandbox_id,
            ended_at=ended_at,
            closed_by=closed_by,
            expected_external_sandbox_id=expected_provider_sandbox_id,
            fail_on_provider_mismatch=True,
        )
        return True


async def _resolve_compute_limit_pause(
    *,
    segment: UsageSegment,
    compute_limits_by_org: dict[UUID, list[BillingBudgetLimit]],
    spend_cache: dict[tuple[UUID, str, UUID | None], float],
    now: datetime,
) -> str | None:
    """Decision type when the segment breaches an org compute cap, else None.

    Enforce-mode only, matching the ``active_spend_hold`` path. Compute limits
    are org-scoped: a segment with no ``organization_id`` (org-less owner) never
    binds. Org usage is summed by ``organization_id`` across every member's
    segments regardless of who pays for each. A per-user cap is compared against
    the segment user's window usage and takes precedence over an org-wide cap.
    """
    if settings.cloud_billing_mode != BILLING_MODE_ENFORCE:
        return None
    organization_id = segment.organization_id
    if organization_id is None:
        return None
    if organization_id not in compute_limits_by_org:
        async with db_engine.async_session_factory() as db:
            org_limits = await billing_store.list_budget_limits(db, organization_id)
        compute_limits_by_org[organization_id] = [
            limit for limit in org_limits if limit.kind == "compute" and limit.enabled
        ]
    limits = compute_limits_by_org[organization_id]
    if not limits:
        return None

    async def _window_seconds(window: str, scope_user_id: UUID | None) -> float:
        key = (organization_id, window, scope_user_id)
        if key not in spend_cache:
            start, end = window_bounds(window, now)
            async with db_engine.async_session_factory() as db:
                spend_cache[key] = await billing_store.compute_usage_seconds_in_window_for_org(
                    db,
                    organization_id=organization_id,
                    start=start,
                    end=end,
                    now=now,
                    user_id=scope_user_id,
                )
        return spend_cache[key]

    if segment.user_id is not None:
        for limit in limits:
            if limit.user_id != segment.user_id:
                continue
            if await _window_seconds(limit.window, segment.user_id) >= float(limit.cap_value):
                return BILLING_DECISION_USER_LIMIT_PAUSE
    for limit in limits:
        if limit.user_id is not None:
            continue
        if await _window_seconds(limit.window, None) >= float(limit.cap_value):
            return BILLING_DECISION_ORG_LIMIT_PAUSE
    return None


async def _enforce_or_reconcile_segment(
    *,
    segment: UsageSegment,
    provider: SandboxProvider,
    state: ProviderSandboxState | None,
    billing_snapshot: BillingSnapshot,
    limit_breached: bool = False,
) -> None:
    async with db_engine.async_session_factory() as db:
        sandbox = await load_cloud_sandbox_by_id(db, segment.sandbox_id)
    if sandbox is None:
        return
    if segment.external_sandbox_id != sandbox.e2b_sandbox_id:
        logger.info(
            "billing reconciler ignored stale provider usage segment",
            extra={
                "sandbox_id": str(sandbox.id),
                "segment_provider_sandbox_id": segment.external_sandbox_id,
                "current_provider_sandbox_id": sandbox.e2b_sandbox_id,
            },
        )
        return
    if sandbox.e2b_sandbox_id is None:
        return

    if state is None and sandbox.e2b_sandbox_id:
        try:
            state = await provider.get_sandbox_state(sandbox.e2b_sandbox_id)
        except Exception:
            logger.exception(
                "billing reconciler failed to directly observe sandbox",
                extra={
                    "sandbox_id": str(sandbox.id),
                    "e2b_sandbox_id": sandbox.e2b_sandbox_id,
                },
            )
            return

    if state is None:
        logger.warning(
            "billing reconciler skipped sandbox with unknown provider state",
            extra={
                "sandbox_id": str(sandbox.id),
                "e2b_sandbox_id": sandbox.e2b_sandbox_id,
            },
        )
        return

    if state.state in {"paused", "stopped"}:
        await _mark_sandbox_environment_unavailable(
            sandbox.id,
            destroyed=False,
            expected_provider_sandbox_id=sandbox.e2b_sandbox_id,
            expected_status=sandbox.status,
            ended_at=state.end_at or state.observed_at,
            closed_by=USAGE_SEGMENT_CLOSED_BY_RECONCILER,
        )
        return

    if state.state in {"killed", "destroyed", "terminated"}:
        await _mark_sandbox_environment_unavailable(
            sandbox.id,
            destroyed=True,
            expected_provider_sandbox_id=sandbox.e2b_sandbox_id,
            expected_status=sandbox.status,
            ended_at=state.end_at or state.observed_at,
            closed_by=USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
        )
        return

    if settings.cloud_billing_mode == BILLING_MODE_ENFORCE and (
        billing_snapshot.active_spend_hold or limit_breached
    ):
        provider = get_configured_sandbox_provider()
        if sandbox.e2b_sandbox_id:
            try:
                await provider.pause_sandbox(sandbox.e2b_sandbox_id)
            except Exception:
                logger.exception(
                    "billing enforcement failed to pause sandbox",
                    extra={
                        "sandbox_id": str(sandbox.id),
                        "e2b_sandbox_id": sandbox.e2b_sandbox_id,
                    },
                )
                return
        ended_at = utcnow()
        await _mark_sandbox_environment_unavailable(
            sandbox.id,
            destroyed=False,
            expected_provider_sandbox_id=sandbox.e2b_sandbox_id,
            expected_status=sandbox.status,
            ended_at=ended_at,
            closed_by=USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
        )


async def run_billing_reconcile_pass() -> None:
    async def _run(_db: object) -> None:
        await run_billing_accounting_pass()

        snapshots_by_subject: dict[UUID, BillingSnapshot] = {}
        recorded_hold_decision_subjects: set[UUID] = set()
        # Org budget-limit enforcement caches (spec §4.2), scoped to this pass:
        # org→enabled compute limits, and org window usage keyed by
        # (organization_id, window, user_id | None).
        compute_limits_by_org: dict[UUID, list[BillingBudgetLimit]] = {}
        compute_spend_cache: dict[tuple[UUID, str, UUID | None], float] = {}
        recorded_limit_decisions: set[tuple[UUID, UUID | None, str]] = set()
        now = utcnow()
        open_segments = await list_all_open_usage_segments()
        # The provider is only needed to reconcile OPEN sandboxes against
        # live provider state; with nothing open there is nothing to list, so
        # skip the provider round-trip entirely. This also keeps the pass from
        # requiring a configured sandbox provider when it has no open segments
        # to reconcile (e.g. accounting-only runs).
        provider = get_configured_sandbox_provider() if open_segments else None
        states = await provider.list_sandbox_states() if provider is not None else []
        states_by_external_id = {state.external_sandbox_id: state for state in states}
        for segment in open_segments:
            # open_segments is non-empty here, so the provider was resolved
            # above. Not an `assert`: those vanish under `python -O`, and this
            # invariant guards real reconciliation work.
            if provider is None:
                raise RuntimeError("sandbox provider unresolved with open usage segments")
            billing_snapshot = snapshots_by_subject.get(segment.billing_subject_id)
            if billing_snapshot is None:
                billing_snapshot = await get_billing_snapshot_for_subject(
                    segment.billing_subject_id
                )
                snapshots_by_subject[segment.billing_subject_id] = billing_snapshot
            if (
                billing_snapshot.active_spend_hold
                and segment.billing_subject_id not in recorded_hold_decision_subjects
            ):
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
                recorded_hold_decision_subjects.add(segment.billing_subject_id)
            limit_decision = await _resolve_compute_limit_pause(
                segment=segment,
                compute_limits_by_org=compute_limits_by_org,
                spend_cache=compute_spend_cache,
                now=now,
            )
            if limit_decision is not None:
                decision_key = (segment.billing_subject_id, segment.user_id, limit_decision)
                if decision_key not in recorded_limit_decisions:
                    await record_billing_decision_event(
                        billing_subject_id=segment.billing_subject_id,
                        actor_user_id=segment.user_id,
                        workspace_id=segment.workspace_id,
                        decision_type=limit_decision,
                        mode=settings.cloud_billing_mode,
                        would_block_start=False,
                        would_pause_active=True,
                        reason="compute budget limit reached",
                        active_sandbox_count=billing_snapshot.active_sandbox_count,
                        remaining_seconds=billing_snapshot.remaining_seconds,
                    )
                    recorded_limit_decisions.add(decision_key)
            await _enforce_or_reconcile_segment(
                segment=segment,
                provider=provider,
                state=(
                    states_by_external_id.get(segment.external_sandbox_id)
                    if segment.external_sandbox_id
                    else None
                ),
                billing_snapshot=billing_snapshot,
                limit_breached=limit_decision is not None,
            )

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
            report_critical(
                exc,
                tags={
                    "domain": "billing",
                    "action": "reconcile_loop",
                },
            )
        await asyncio.sleep(max(BILLING_RECONCILE_INTERVAL_SECONDS, 30))


def start_billing_reconciler() -> None:
    global _reconciler_task
    if not settings.run_background_workers:
        return
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
