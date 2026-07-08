"""Background billing reconciliation and quota enforcement."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_ENFORCE_ACTIVE_SPEND,
    BILLING_DECISION_ORG_LIMIT_PAUSE,
    BILLING_DECISION_USER_LIMIT_PAUSE,
    BILLING_MODE_ENFORCE,
    BILLING_RECONCILE_INTERVAL_SECONDS,
    USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
    USAGE_SEGMENT_CLOSED_BY_RECONCILER,
    USAGE_SEGMENT_OPENED_BY_RECONCILER_REPAIR,
)
from proliferate.constants.cloud import CloudRuntimeEnvironmentStatus
from proliferate.db import engine as db_engine
from proliferate.db.models.billing import BillingBudgetLimit, UsageSegment
from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import billing as billing_store
from proliferate.db.store.billing_runtime_usage import (
    close_usage_segment_for_sandbox as close_usage_segment_for_sandbox_record,
)
from proliferate.db.store.billing_runtime_usage import (
    list_all_open_usage_segments as list_all_open_usage_segments_record,
)
from proliferate.db.store.billing_runtime_usage import (
    open_usage_segment_for_sandbox as open_usage_segment_for_sandbox_record,
)
from proliferate.db.store.billing_runtime_usage import (
    record_billing_decision_event as record_billing_decision_event_record,
)
from proliferate.db.store.billing_runtime_usage import (
    release_billing_reconciler_lock,
    try_acquire_billing_reconciler_lock,
)
from proliferate.db.store.billing_subjects import get_billing_subject_by_id
from proliferate.db.store.cloud_runtime_environments import (
    load_runtime_environment_by_id,
    save_runtime_environment_state,
)
from proliferate.db.store.cloud_sandboxes import (
    load_cloud_sandbox_by_id,
    load_cloud_sandbox_placeholders,
    save_sandbox_provider_state,
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
from proliferate.utils.time import utcnow

logger = logging.getLogger("proliferate.billing.reconciler")

_reconciler_task: asyncio.Task[None] | None = None


async def open_usage_segment_for_sandbox(
    *,
    runtime_environment_id: UUID | None = None,
    workspace_id: UUID | None = None,
    sandbox_id: UUID,
    external_sandbox_id: str | None,
    sandbox_execution_id: str | None,
    started_at: datetime,
    opened_by: str,
    user_id: UUID | None = None,
    is_billable: bool = True,
    event_id: str | None = None,
) -> UsageSegment:
    async with db_engine.async_session_factory() as db, db.begin():
        return await open_usage_segment_for_sandbox_record(
            db,
            runtime_environment_id=runtime_environment_id,
            workspace_id=workspace_id,
            sandbox_id=sandbox_id,
            external_sandbox_id=external_sandbox_id,
            sandbox_execution_id=sandbox_execution_id,
            started_at=started_at,
            opened_by=opened_by,
            user_id=user_id,
            is_billable=is_billable,
            event_id=event_id,
        )


async def close_usage_segment_for_sandbox(
    *,
    sandbox_id: UUID,
    ended_at: datetime,
    closed_by: str,
    is_billable: bool | None = None,
    event_id: str | None = None,
) -> UsageSegment | None:
    async with db_engine.async_session_factory() as db, db.begin():
        return await close_usage_segment_for_sandbox_record(
            db,
            sandbox_id=sandbox_id,
            ended_at=ended_at,
            closed_by=closed_by,
            is_billable=is_billable,
            event_id=event_id,
        )


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


def _is_running_state(state: str) -> bool:
    return state in {"running", "started"}


async def _mark_environment_unavailable(
    runtime_environment_id: UUID | None,
    *,
    destroyed: bool,
) -> None:
    if runtime_environment_id is None:
        return
    async with db_engine.async_session_factory() as db, db.begin():
        environment = await load_runtime_environment_by_id(db, runtime_environment_id)
        if environment is None:
            return
        if destroyed:
            await save_runtime_environment_state(
                db,
                environment.id,
                status=CloudRuntimeEnvironmentStatus.error.value,
                runtime_url=None,
                runtime_token_ciphertext=None,
                active_sandbox_id=None,
                increment_runtime_generation=True,
                last_error="Provider sandbox was destroyed.",
            )
        else:
            await save_runtime_environment_state(
                db,
                environment.id,
                status=CloudRuntimeEnvironmentStatus.paused.value,
            )


async def _load_sandbox_runtime_owner(
    db: AsyncSession,
    sandbox_id: UUID,
) -> tuple[CloudRuntimeEnvironment | None, CloudWorkspace | None]:
    environment = (
        await db.execute(
            select(CloudRuntimeEnvironment)
            .where(CloudRuntimeEnvironment.active_sandbox_id == sandbox_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    workspace = (
        await db.execute(
            select(CloudWorkspace).where(CloudWorkspace.active_sandbox_id == sandbox_id).limit(1)
        )
    ).scalar_one_or_none()
    return environment, workspace


async def _mark_sandbox_environment_unavailable(
    sandbox_id: UUID,
    *,
    destroyed: bool,
) -> None:
    async with db_engine.async_session_factory() as db:
        environment, _workspace = await _load_sandbox_runtime_owner(db, sandbox_id)
    await _mark_environment_unavailable(
        environment.id if environment is not None else None,
        destroyed=destroyed,
    )


async def _repair_placeholders(
    *,
    states_by_placeholder_id: dict[str, ProviderSandboxState],
) -> None:
    async with db_engine.async_session_factory() as db:
        placeholders = await load_cloud_sandbox_placeholders(db)
    for placeholder in placeholders:
        state = states_by_placeholder_id.get(str(placeholder.id))
        if state is None:
            continue
        async with db_engine.async_session_factory() as db:
            environment, workspace = await _load_sandbox_runtime_owner(db, placeholder.id)
        if environment is None and workspace is None:
            continue
        async with db_engine.async_session_factory() as db, db.begin():
            await save_sandbox_provider_state(
                db,
                placeholder.id,
                external_sandbox_id=state.external_sandbox_id,
                status="running" if _is_running_state(state.state) else state.state,
                started_at=state.started_at,
            )
        if _is_running_state(state.state):
            await open_usage_segment_for_sandbox(
                user_id=environment.user_id if environment is not None else workspace.user_id,
                runtime_environment_id=environment.id if environment is not None else None,
                workspace_id=workspace.id if workspace is not None else None,
                sandbox_id=placeholder.id,
                external_sandbox_id=state.external_sandbox_id,
                sandbox_execution_id=None,
                started_at=state.started_at or state.observed_at,
                opened_by=USAGE_SEGMENT_OPENED_BY_RECONCILER_REPAIR,
            )


async def _resolve_compute_limit_pause(
    *,
    segment: UsageSegment,
    org_id_by_subject: dict[UUID, UUID | None],
    compute_limits_by_org: dict[UUID, list[BillingBudgetLimit]],
    spend_cache: dict[tuple[UUID, str, UUID | None], float],
    now: datetime,
) -> str | None:
    """Decision type when the segment breaches an org compute cap, else None.

    Enforce-mode only, matching the ``active_spend_hold`` path. Compute limits
    are org-scoped: personal subjects (no ``organization_id``) never bind. A
    per-user cap is compared against the segment user's window usage and takes
    precedence over an org-wide cap, which sums the whole subject.
    """
    if settings.cloud_billing_mode != BILLING_MODE_ENFORCE:
        return None
    subject_id = segment.billing_subject_id
    if subject_id not in org_id_by_subject:
        async with db_engine.async_session_factory() as db:
            subject = await get_billing_subject_by_id(db, subject_id)
        org_id_by_subject[subject_id] = subject.organization_id if subject is not None else None
    organization_id = org_id_by_subject[subject_id]
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
        key = (subject_id, window, scope_user_id)
        if key not in spend_cache:
            start, end = window_bounds(window, now)
            async with db_engine.async_session_factory() as db:
                spend_cache[key] = await billing_store.compute_usage_seconds_in_window(
                    db,
                    billing_subject_id=subject_id,
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

    if state is None and sandbox.external_sandbox_id:
        try:
            state = await provider.get_sandbox_state(sandbox.external_sandbox_id)
        except Exception:
            logger.exception(
                "billing reconciler failed to directly observe sandbox",
                extra={
                    "sandbox_id": str(sandbox.id),
                    "external_sandbox_id": sandbox.external_sandbox_id,
                },
            )
            return

    if state is None:
        logger.warning(
            "billing reconciler skipped sandbox with unknown provider state",
            extra={
                "sandbox_id": str(sandbox.id),
                "external_sandbox_id": sandbox.external_sandbox_id,
            },
        )
        return

    if state.state in {"paused", "stopped"}:
        await close_usage_segment_for_sandbox(
            sandbox_id=sandbox.id,
            ended_at=state.end_at or state.observed_at,
            closed_by=USAGE_SEGMENT_CLOSED_BY_RECONCILER,
        )
        async with db_engine.async_session_factory() as db, db.begin():
            await save_sandbox_provider_state(
                db,
                sandbox.id,
                status="paused",
                stopped_at=state.end_at or state.observed_at,
            )
        await _mark_sandbox_environment_unavailable(sandbox.id, destroyed=False)
        return

    if state.state in {"killed", "destroyed", "terminated"}:
        await close_usage_segment_for_sandbox(
            sandbox_id=sandbox.id,
            ended_at=state.end_at or state.observed_at,
            closed_by=USAGE_SEGMENT_CLOSED_BY_RECONCILER,
        )
        async with db_engine.async_session_factory() as db, db.begin():
            await save_sandbox_provider_state(
                db,
                sandbox.id,
                status="destroyed",
                stopped_at=state.end_at or state.observed_at,
            )
        await _mark_sandbox_environment_unavailable(sandbox.id, destroyed=True)
        return

    if settings.cloud_billing_mode == BILLING_MODE_ENFORCE and (
        billing_snapshot.active_spend_hold or limit_breached
    ):
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
                return
        ended_at = utcnow()
        await close_usage_segment_for_sandbox(
            sandbox_id=sandbox.id,
            ended_at=ended_at,
            closed_by=USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
        )
        async with db_engine.async_session_factory() as db, db.begin():
            await save_sandbox_provider_state(
                db,
                sandbox.id,
                status="paused",
                stopped_at=ended_at,
            )
        await _mark_sandbox_environment_unavailable(sandbox.id, destroyed=False)


async def run_billing_reconcile_pass() -> None:
    async def _run(_db: object) -> None:
        await run_billing_accounting_pass()

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
        # Org budget-limit enforcement caches (spec §4.2), scoped to this pass:
        # subject→org, org→enabled compute limits, and window usage.
        org_id_by_subject: dict[UUID, UUID | None] = {}
        compute_limits_by_org: dict[UUID, list[BillingBudgetLimit]] = {}
        compute_spend_cache: dict[tuple[UUID, str, UUID | None], float] = {}
        recorded_limit_decisions: set[tuple[UUID, UUID | None, str]] = set()
        now = utcnow()
        open_segments = await list_all_open_usage_segments()
        for segment in open_segments:
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
                org_id_by_subject=org_id_by_subject,
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
