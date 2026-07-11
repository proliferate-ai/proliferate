"""Cloud-lane delivery + observed-state reconciliation (spec 3.2).

The desktop lane hands the resolved plan to a *local* runtime itself; this module
owns the **cloud lane**, where the control plane delivers the plan gateway-direct
to sandbox anyharness (the same authenticated path clients use) and — because v1
ships no worker→server push channel — offers a manual refresh that reads observed
state back through the gateway.

Delivery is synchronous in the StartRun request. That is the house-consistent
choice: cloud workspace creation and every gateway proxy call already wake the
sandbox and talk to anyharness in-request via
``ensure_cloud_sandbox_gateway_access`` (which resolves ``upstream_base_url`` +
``upstream_token`` after the wake). The spec is explicit that "a pending-delivery
record bridges the gap, not a work queue", so no outbox/Celery task is warranted:
the run id travels in the payload, anyharness dedupes, and a typed delivery
failure leaves the run *pending_delivery* (non-terminal) with a
``delivery_failed`` marker so ``POST /runs/{id}/deliver`` can retry.
"""

from __future__ import annotations

import contextlib
import logging
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.config import settings
from proliferate.constants.billing import BILLING_MODE_ENFORCE
from proliferate.constants.cloud import CLOUD_SANDBOX_PURPOSE_WORKFLOW_RUN
from proliferate.constants.workflows import (
    WORKFLOW_CLOUD_DELIVERY_TIMEOUT_SECONDS,
    WORKFLOW_CLOUD_REFRESH_TIMEOUT_SECONDS,
    WORKFLOW_DELIVERY_ERROR_CODE,
    WORKFLOW_RUN_ERROR_BUDGET_BLOCKED,
    WORKFLOW_RUN_OBSERVABLE_STATUSES,
    WORKFLOW_RUN_STATUS_CANCELLED,
    WORKFLOW_RUN_STATUS_FAILED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_RUN_STATUS_RUNNING,
    WORKFLOW_TARGET_MODE_LOCAL,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
)
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store.cloud_workflows import WorkflowRunRecord
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.workflow_runs import (
    cancel_workflow_run,
    deliver_workflow_run,
    read_workflow_run,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.gateway.service import ensure_cloud_sandbox_gateway_access
from proliferate.server.cloud.integration_gateway.domain.scope import (
    intersect_namespaces_with_worker,
)
from proliferate.server.cloud.workflows.domain.run_status import (
    RunTransitionError,
    check_transition,
    is_terminal,
)
from proliferate.server.cloud.workflows.gateway_grants import (
    granted_namespaces,
    resolve_run_scope,
)
from proliferate.server.cloud.workflows.service import _visible_run
from proliferate.server.cloud.workflows.worker.service import mark_run_delivered
from proliferate.utils.time import utcnow

logger = logging.getLogger(__name__)

_ERROR_MESSAGE_MAX_CHARS = 480


def _truncate(message: str) -> str:
    normalized = message.strip()
    return (
        normalized
        if len(normalized) <= _ERROR_MESSAGE_MAX_CHARS
        else (f"{normalized[: _ERROR_MESSAGE_MAX_CHARS - 1]}…")
    )


# --- Delivery ------------------------------------------------------------------


async def _record_delivery_failure(
    db: AsyncSession, run_id: UUID, message: str
) -> WorkflowRunRecord:
    updated = await store.update_run(
        db,
        run_id=run_id,
        error_code=WORKFLOW_DELIVERY_ERROR_CODE,
        error_message=_truncate(f"Cloud delivery failed: {message}"),
    )
    assert updated is not None
    return updated


async def _budget_block_reason(db: AsyncSession, *, owner_user_id: UUID) -> str | None:
    """Return a block reason if the run owner's billing subject is over budget.

    Mirrors the interactive sandbox-start gate (billing.authorization): in
    ``enforce`` mode a ``start_blocked`` snapshot denies the start. v1 scheduled
    runs execute as the workflow owner on their personal cloud, so we gate on the
    owner's personal billing subject (the same snapshot the overview + reconciler
    build). Read-only against the caller's session; the terminal run row itself is
    the durable record of the block, so no separate decision event is emitted.
    """

    if settings.cloud_billing_mode != BILLING_MODE_ENFORCE:
        return None
    # Imported lazily: the billing snapshot module pulls in a wide slice of the
    # billing store, and delivery.py is imported by the scheduler at boot.
    from proliferate.server.billing import snapshot_state
    from proliferate.server.billing.snapshots import (
        build_billing_snapshot,
        state_with_overage_usage,
    )

    state = await snapshot_state.load_snapshot_state_for_user(db, owner_user_id)
    state = await state_with_overage_usage(db, state)
    snapshot = build_billing_snapshot(state)
    if not snapshot.start_blocked:
        return None
    return snapshot.start_block_reason or "Organization is over its usage budget."


async def _land_budget_blocked(
    db: AsyncSession, run: WorkflowRunRecord, reason: str
) -> WorkflowRunRecord:
    """Land a terminal ``budget_blocked`` run WITHOUT waking a sandbox (D-002).

    A scheduled/unattended run that fires while the owner is over budget must fail
    fast and visibly, never hang or silently retry. This is the pre-dispatch gate:
    it runs before ``ensure_cloud_sandbox_gateway_access`` (the sandbox wake), so
    no sandbox is launched and no agent is dispatched. Reuses the shared terminal
    side effects (expire the per-run gateway token, then run step actions so a
    notify-on-finish still fires) exactly like cancel/report-terminal.
    """

    now = utcnow()
    updated = await store.update_run(
        db,
        run_id=run.id,
        status=WORKFLOW_RUN_STATUS_FAILED,
        error_code=WORKFLOW_RUN_ERROR_BUDGET_BLOCKED,
        error_message=_truncate(reason),
        finished_at=now,
    )
    assert updated is not None
    await store.expire_run_gateway_tokens_for_run(db, workflow_run_id=run.id)
    try:
        from proliferate.server.cloud.workflows.actions import apply_step_actions

        await apply_step_actions(db, run=updated)
    except Exception:
        logger.exception("apply_step_actions failed on budget_blocked run_id=%s", run.id)
    return updated


async def deliver_cloud_run(
    db: AsyncSession, user: ActorIdentity, run: WorkflowRunRecord
) -> WorkflowRunRecord:
    """Deliver a ``personal_cloud`` run's plan to sandbox anyharness (idempotent).

    Success marks the run delivered via the shared ``mark_run_delivered``
    transition (the same one the ``/delivered`` endpoint uses). A wake/transport
    failure records a ``delivery_failed`` marker and leaves the run pending so it
    stays retryable.
    """

    if run.target_mode != WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        raise CloudApiError(
            "delivery_not_supported",
            "Only cloud runs are delivered by the server.",
            status_code=400,
        )
    # Idempotent: a run already past pending_delivery was handed over; do nothing.
    if run.status != WORKFLOW_RUN_STATUS_PENDING_DELIVERY:
        return run
    workspace_id = run.anyharness_workspace_id
    if not workspace_id:
        raise CloudApiError(
            "target_workspace_not_ready",
            "The cloud workspace for this run is not ready.",
            status_code=409,
        )

    # D-002 pre-dispatch budget gate: if the owner is over budget, land a terminal
    # budget_blocked run BEFORE the sandbox wake below. This is the dispatch
    # boundary — no sandbox is launched, no agent dispatched, no silent retry.
    budget_reason = await _budget_block_reason(db, owner_user_id=run.executor_user_id)
    if budget_reason is not None:
        logger.info(
            "workflow scheduled run budget_blocked run_id=%s reason=%s", run.id, budget_reason
        )
        return await _land_budget_blocked(db, run, budget_reason)

    try:
        # L26: waking the sandbox for a workflow run stamps 'workflow-run' iff this
        # is the create; an existing sandbox keeps its stamped purpose.
        access = await ensure_cloud_sandbox_gateway_access(
            db, user, purpose=CLOUD_SANDBOX_PURPOSE_WORKFLOW_RUN
        )
        # L25: now the delivering worker is known, intersect the run's frozen scope
        # (ceiling) with the worker's allowlist and re-freeze BEFORE the plan ships.
        plan = await _apply_delivery_scope_intersection(db, run)
        await deliver_workflow_run(
            access.upstream_base_url,
            access.upstream_token,
            plan=plan,
            workspace_id=workspace_id,
            timeout=WORKFLOW_CLOUD_DELIVERY_TIMEOUT_SECONDS,
        )
    except (CloudApiError, CloudRuntimeReconnectError) as exc:
        message = exc.message if isinstance(exc, CloudApiError) else str(exc)
        return await _record_delivery_failure(db, run.id, message)

    return await mark_run_delivered(db, user, run.id)


async def _apply_delivery_scope_intersection(
    db: AsyncSession, run: WorkflowRunRecord
) -> dict[str, object]:
    """Narrow the run's frozen gateway scope to the delivering worker's allowlist.

    L25 layer 2 ⊆ layer 1, computed at delivery because the worker is only known
    now. NULL worker scope = unscoped passthrough (run scope unchanged, distinct
    from an empty allowlist). Re-freezes both the token row and the plan's gateway
    block so the shipped plan and the enforced token agree.

    Per-slot narrowing (track 3c phase 2) is preserved: each slot's OWN namespace
    list is intersected with the worker allowlist independently — recomputed from the
    pinned version's definition, exactly as StartRun/rotate resolve it. Stamping
    every slot with the flat union (the earlier bug) silently widened a narrowed
    slot's stored grant. The plan's flat ``gateway.integrations`` stays the union of
    the per-slot intersections; the runtime only reads its emptiness for the L22
    local-lane fail-fast, and enforcement is union-at-gateway until Part II slot
    identity (``_flatten_run_scope`` in integration_gateway/dependencies.py).
    """

    plan = dict(run.resolved_plan_json or {})
    gateway = plan.get("gateway")
    if not isinstance(gateway, dict):
        return plan
    # E3: the plan's gateway carries the flat NAMESPACE grant; the token's
    # scope_json is per-slot. Narrow both at namespace granularity.
    run_namespaces = gateway.get("integrations")
    if not isinstance(run_namespaces, list):
        return plan
    worker_scope = await runtime_workers_store.get_active_worker_gateway_scope_for_owner(
        db, owner_user_id=run.executor_user_id
    )
    # NULL worker scope = unscoped passthrough: the frozen (already per-slot) scope
    # is enforced as-is; nothing to narrow.
    if worker_scope is None:
        return plan
    version = await store.get_version(db, run.workflow_version_id)
    if version is None:  # pragma: no cover - pinned versions are immutable
        return plan
    # Intersect EACH slot's own grant with the worker allowlist so a slot narrowed at
    # StartRun keeps its narrowing and never gains a worker-allowed namespace it was
    # not granted.
    run_scope = resolve_run_scope(version.definition_json)
    new_scope_json: dict[str, dict[str, object]] = {}
    for slot, slot_scope in run_scope.items():
        slot_namespaces = [
            ns for ns in (slot_scope.get("integrations") or []) if isinstance(ns, str)
        ]
        new_scope_json[slot] = {
            "integrations": intersect_namespaces_with_worker(slot_namespaces, worker_scope)
        }
    intersected_union = granted_namespaces(new_scope_json)
    # Worker allowlist ⊇ the run's union: no namespace dropped from any slot.
    if intersected_union == sorted(run_namespaces):
        return plan
    await store.refreeze_run_gateway_token_scope(
        db, workflow_run_id=run.id, scope_json=new_scope_json
    )
    gateway = dict(gateway)
    gateway["integrations"] = intersected_union
    plan["gateway"] = gateway
    updated = await store.update_run(db, run_id=run.id, resolved_plan_json=plan)
    return updated.resolved_plan_json if updated is not None else plan


# --- Refresh (observed-state reconciliation) -----------------------------------


@dataclass(frozen=True)
class _SandboxRunView:
    status: str | None
    step_cursor: int | None
    step_outputs: dict[str, object] | None
    session_ids: list[str] | None
    workspace_id: str | None
    error_code: str | None
    error_message: str | None


def _parse_sandbox_run_view(payload: object) -> _SandboxRunView:
    data = payload if isinstance(payload, dict) else {}
    raw_steps = data.get("steps")
    step_outputs: dict[str, object] = {}
    if isinstance(raw_steps, list):
        for step in raw_steps:
            if not isinstance(step, dict):
                continue
            index = step.get("stepIndex")
            output = step.get("output")
            if isinstance(index, int) and output is not None:
                step_outputs[str(index)] = output
    raw_sessions = data.get("sessionIds")
    session_ids = (
        [s for s in raw_sessions if isinstance(s, str)] if isinstance(raw_sessions, list) else None
    )
    status = data.get("status")
    return _SandboxRunView(
        status=status if isinstance(status, str) else None,
        step_cursor=data.get("stepCursor") if isinstance(data.get("stepCursor"), int) else None,
        step_outputs=step_outputs or None,
        session_ids=session_ids,
        workspace_id=data.get("workspaceId") if isinstance(data.get("workspaceId"), str) else None,
        error_code=data.get("errorCode") if isinstance(data.get("errorCode"), str) else None,
        error_message=(
            data.get("errorMessage") if isinstance(data.get("errorMessage"), str) else None
        ),
    )


async def _sync_run_from_view(
    db: AsyncSession, run_id: UUID, view: _SandboxRunView
) -> WorkflowRunRecord:
    """Lenient reconciliation: apply the observed snapshot, never move out of terminal.

    Refresh is a reconciling *read*, not the sequential ``/status`` report, so it
    skips the strict transition guard — but it still refuses to overwrite a run
    the server already considers terminal.
    """

    locked = await store.lock_run(db, run_id)
    if locked is None:
        raise CloudApiError("workflow_run_not_found", "Workflow run not found.", status_code=404)
    if is_terminal(locked.status):
        return locked

    observed_status = view.status if view.status in WORKFLOW_RUN_OBSERVABLE_STATUSES else None
    now = utcnow()
    started_at = (
        now
        if observed_status == WORKFLOW_RUN_STATUS_RUNNING and locked.started_at is None
        else None
    )
    finished_at = (
        now
        if observed_status is not None
        and is_terminal(observed_status)
        and locked.finished_at is None
        else None
    )

    updated = await store.update_run(
        db,
        run_id=run_id,
        status=observed_status,
        step_cursor=view.step_cursor,
        step_outputs_json=view.step_outputs,
        anyharness_session_ids=view.session_ids,
        anyharness_workspace_id=view.workspace_id,
        error_code=view.error_code,
        error_message=view.error_message,
        started_at=started_at,
        finished_at=finished_at,
    )
    assert updated is not None

    # Terminal via the reconcile path (a ping- or scheduler-driven refresh that
    # observes completion) expires the per-run gateway token too — idempotent, so
    # a later report or refresh that also sees terminal is a no-op.
    if is_terminal(updated.status):
        await store.expire_run_gateway_tokens_for_run(db, workflow_run_id=run_id)

    try:
        from proliferate.server.cloud.workflows.actions import apply_step_actions

        await apply_step_actions(db, run=updated)
    except Exception:
        logger.exception("apply_step_actions failed run_id=%s", run_id)

    return updated


async def refresh_cloud_run(
    db: AsyncSession, user: ActorIdentity, run: WorkflowRunRecord
) -> WorkflowRunRecord:
    """Pull the sandbox run view via the gateway and sync it into the ledger.

    Cloud runs only. Gives the UI a poll path in the absence of a push channel.
    """

    if run.target_mode != WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        raise CloudApiError(
            "refresh_not_supported",
            "Only cloud runs can be refreshed from the sandbox.",
            status_code=400,
        )
    if is_terminal(run.status):
        return run

    try:
        access = await ensure_cloud_sandbox_gateway_access(db, user)
        payload = await read_workflow_run(
            access.upstream_base_url,
            access.upstream_token,
            run_id=str(run.id),
            timeout=WORKFLOW_CLOUD_REFRESH_TIMEOUT_SECONDS,
        )
    except CloudRuntimeReconnectError as exc:
        raise CloudApiError(
            "cloud_run_refresh_failed",
            _truncate(f"Sandbox refresh read failed: {exc}"),
            status_code=502,
        ) from exc

    if payload is None:
        # The sandbox doesn't know this run yet (pre-delivery or a fresh restart);
        # leave the ledger untouched.
        return run
    return await _sync_run_from_view(db, run.id, _parse_sandbox_run_view(payload))


async def observe_run_ping(db: AsyncSession, *, run_id: UUID, actor: ActorIdentity) -> None:
    """Completion ping (L16 / §3.7): nudge an observed-state refresh for the pinged
    run. The caller (``access.authorize_run_ping``) already proved the per-run
    gateway token matches ``run_id``; this only decides whether there is anything
    to refresh.

    Local-lane runs are observed by the desktop relay, which owns local
    observation, so this no-ops for them. A failed refresh never changes engine
    state — the ping is a nudge, not a transition; the scheduler phase-3 sweep
    remains the backstop.
    """

    run = await store.get_run(db, run_id)
    if run is None or run.target_mode != WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        return
    with contextlib.suppress(CloudApiError):
        await refresh_cloud_run(db, actor, run)


# --- take-over / cancel (D15) --------------------------------------------------


async def cancel_run(db: AsyncSession, user: ActorIdentity, run_id: UUID) -> WorkflowRunRecord:
    """Take over / cancel a run (D15). The single human override: flip the desired
    status to ``cancelled``, stamp ``stopped_by_user_id`` + ``finished_at``, run
    the shared terminal side effects (expire the per-run gateway token, apply step
    actions), then best-effort nudge the runtime to stop the live actor.

    The server write going terminal IS the release (C13 / L17): the runtime derives
    session held-ness from the run row, so every session the run held is freed to
    normal interactive ownership even if the runtime is momentarily unreachable
    (a later refresh reconciles). The runtime nudge is therefore best-effort — a
    404/transport failure never fails take-over. Local runs are relayed by the
    desktop, so the server only performs the terminal write for them.
    """

    # Owner-scoped 404 (visible_run raises not-found for a run the user can't see).
    run = await _visible_run(db, user=user, run_id=run_id)
    if is_terminal(run.status):
        return run

    locked = await store.lock_run(db, run_id)
    if locked is None:
        raise CloudApiError("workflow_run_not_found", "Workflow run not found.", status_code=404)
    try:
        check_transition(locked.status, WORKFLOW_RUN_STATUS_CANCELLED)
    except RunTransitionError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=409) from exc

    now = utcnow()
    updated = await store.update_run(
        db,
        run_id=run_id,
        status=WORKFLOW_RUN_STATUS_CANCELLED,
        finished_at=now if locked.finished_at is None else None,
        stopped_by_user_id=user.id,
    )
    assert updated is not None

    # Shared terminal side effects (reused from report_run_status): expire the
    # per-run token before applying step actions so a crash mid-actions still
    # leaves the token dead.
    await store.expire_run_gateway_tokens_for_run(db, workflow_run_id=run_id)
    try:
        from proliferate.server.cloud.workflows.actions import apply_step_actions

        await apply_step_actions(db, run=updated)
    except Exception:
        logger.exception("apply_step_actions failed on cancel run_id=%s", run_id)

    # Best-effort runtime nudge. Cloud lane: POST the runtime cancel through the
    # sandbox gateway. Local lane: the desktop relays cancel to its own runtime, so
    # the server does not reach out.
    if updated.target_mode != WORKFLOW_TARGET_MODE_LOCAL:
        try:
            access = await ensure_cloud_sandbox_gateway_access(db, user)
            await cancel_workflow_run(
                access.upstream_base_url,
                access.upstream_token,
                run_id=str(run_id),
                timeout=WORKFLOW_CLOUD_REFRESH_TIMEOUT_SECONDS,
            )
        except (CloudApiError, CloudRuntimeReconnectError) as exc:
            # The run is already terminal + released; a failed nudge is benign.
            logger.warning("runtime cancel nudge failed run_id=%s: %s", run_id, exc)

    return updated
