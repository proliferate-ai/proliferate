"""Cloud-lane delivery + observed-state reconciliation (spec 3.2 / §10.2).

The desktop lane hands the resolved plan to a *local* runtime itself; this module
owns the **cloud lane** — the control plane delivers the plan gateway-direct to
sandbox anyharness, and (no worker->server push channel in v1) offers a manual
refresh that reads observed state back through the gateway.

Commit-before-delivery (§10.2): the run intent is committed BEFORE ``deliver_
cloud_run`` makes any sandbox/runtime network call — the manual lane commits in
the StartRun endpoint, the scheduler commits in phase 1, and the WS4a outbox relay
commits the intent+outbox row — so a rolled-back request can never orphan a
runtime. ``deliver_cloud_run`` stays idempotent and shared across all three
callers: the run id travels in the payload, anyharness dedupes, and a typed
delivery failure leaves the run ``pending_delivery`` (non-terminal) with
``delivery_state=retryable_ready`` so /deliver + the relay retry.
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
    WORKFLOW_DELIVERY_STATE_MATERIALIZING,
    WORKFLOW_DELIVERY_STATE_RETRYABLE_READY,
    WORKFLOW_DELIVERY_STATE_TERMINAL_FAILURE,
    WORKFLOW_DESIRED_STATE_CANCEL_REQUESTED,
    WORKFLOW_EXECUTION_HEALTH_SUSPECT,
    WORKFLOW_PREACCEPT_CANCEL_CANCELLED,
    WORKFLOW_RUN_ERROR_BUDGET_BLOCKED,
    WORKFLOW_RUN_OBSERVABLE_STATUSES,
    WORKFLOW_RUN_STATUS_CANCELLED,
    WORKFLOW_RUN_STATUS_CLAIMABLE,
    WORKFLOW_RUN_STATUS_FAILED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_RUN_STATUS_RUNNING,
    WORKFLOW_TARGET_MODE_LOCAL,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
)
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store import workflow_ledger as ledger
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
from proliferate.server.cloud.workflows.models import build_delivered_plan
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


async def _run_step_actions(db: AsyncSession, run: WorkflowRunRecord) -> None:
    """Run a run's step actions (notify/emit side effects), swallowing failures — a
    broken notify never fails the terminal/delivery write that triggered it."""

    try:
        from proliferate.server.cloud.workflows.actions import apply_step_actions

        await apply_step_actions(db, run=run)
    except Exception:
        logger.exception("apply_step_actions failed run_id=%s", run.id)


# --- Delivery ------------------------------------------------------------------


async def _record_delivery_failure(
    db: AsyncSession, run_id: UUID, message: str
) -> WorkflowRunRecord:
    """Mark a delivery attempt failed but retryable (WS2c §8.1 delivery axis): the
    run stays ``pending_delivery`` (so /deliver + the relay retry) and
    ``delivery_state=retryable_ready`` — WITHOUT touching any observed_* field (a
    failed delivery never fabricates an observation)."""

    updated = await store.update_run(
        db,
        run_id=run_id,
        error_code=WORKFLOW_DELIVERY_ERROR_CODE,
        error_message=_truncate(f"Cloud delivery failed: {message}"),
        delivery_state=WORKFLOW_DELIVERY_STATE_RETRYABLE_READY,
    )
    assert updated is not None
    return updated


async def _budget_block_reason(db: AsyncSession, *, owner_user_id: UUID) -> str | None:
    """Return a block reason if the run owner's billing subject is over budget.

    Mirrors the interactive sandbox-start gate (billing.authorization): in
    ``enforce`` mode a ``start_blocked`` snapshot denies the start. v1 runs execute
    as the workflow owner on their personal cloud, so we gate on the owner's personal
    billing subject. Read-only; the terminal run row is the durable record of the
    block, so no separate decision event is emitted.
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

    The pre-dispatch gate: it runs before ``ensure_cloud_sandbox_gateway_access``
    (the wake), so no sandbox launches and no agent dispatches. Reuses the shared
    terminal side effects (expire the per-run token, then run step actions so a
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
        # The dispatch is permanently abandoned (no sandbox woken): the delivery
        # axis terminates without ever reaching a runtime (§8.1).
        delivery_state=WORKFLOW_DELIVERY_STATE_TERMINAL_FAILURE,
    )
    assert updated is not None
    await store.expire_run_gateway_tokens_for_run(db, workflow_run_id=run.id)
    await _run_step_actions(db, updated)
    return updated


async def deliver_cloud_run(
    db: AsyncSession, user: ActorIdentity, run: WorkflowRunRecord
) -> WorkflowRunRecord:
    """Deliver a ``personal_cloud`` run's plan to sandbox anyharness (idempotent).

    Success marks the run delivered via the shared ``mark_run_delivered``; a
    wake/transport failure records a ``delivery_failed`` marker + ``retryable_ready``
    and leaves the run pending. Shared by the StartRun endpoint, /deliver, scheduler
    phase 2, and the WS4a outbox relay — the run intent is always committed first.
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

    # Delivery-state axis (§8.1): the intent is already durable (committed before
    # this network call — §10.2), so materialization here can never orphan a runtime.
    await store.update_run(db, run_id=run.id, delivery_state=WORKFLOW_DELIVERY_STATE_MATERIALIZING)
    try:
        # L26: waking stamps 'workflow-run' iff this is the create.
        access = await ensure_cloud_sandbox_gateway_access(
            db, user, purpose=CLOUD_SANDBOX_PURPOSE_WORKFLOW_RUN
        )
        # L25: narrow the run's frozen scope to the (now-known) worker's allowlist
        # and re-freeze BEFORE the plan ships.
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


def _delivered_plan(
    run: WorkflowRunRecord, gateway: dict[str, object] | None
) -> dict[str, object]:
    """The plan shipped to anyharness: secret-free logical plan + private gateway
    block + pinnable planHash/planVersion (WS2b, §5.2/§5.3)."""
    return build_delivered_plan(
        run.resolved_plan_json or {},
        gateway=gateway,
        plan_hash=run.plan_hash,
        plan_version=run.plan_version,
    )


async def _apply_delivery_scope_intersection(
    db: AsyncSession, run: WorkflowRunRecord
) -> dict[str, object]:
    """Narrow the run's frozen gateway scope to the delivering worker's allowlist
    and return the fully-composed plan to deliver (logical plan + gateway block).

    WS2b: the gateway block lives in the PRIVATE envelope, not the immutable logical
    plan. This reads it from the envelope, narrows it (L25 layer 2 ⊆ layer 1,
    computed at delivery because the worker is only known now), re-freezes the
    envelope + token row, and returns the delivered plan. NULL worker scope =
    unscoped passthrough (run scope unchanged). Per-slot narrowing (track 3c phase 2)
    is preserved: each slot's OWN namespaces are intersected independently, recomputed
    from the pinned version. The flat ``gateway.integrations`` stays the union of the
    per-slot intersections (the runtime reads its emptiness for the L22 local-lane
    fail-fast; enforcement is union-at-gateway until Part II slot identity).
    """

    envelope = dict(run.private_envelope_json or {})
    gateway = envelope.get("gateway")
    if not isinstance(gateway, dict):
        return _delivered_plan(run, None)
    # E3: the gateway carries the flat NAMESPACE grant; the token's scope_json is
    # per-slot. Narrow both at namespace granularity.
    run_namespaces = gateway.get("integrations")
    if not isinstance(run_namespaces, list):
        return _delivered_plan(run, gateway)
    worker_scope = await runtime_workers_store.get_active_worker_gateway_scope_for_owner(
        db, owner_user_id=run.executor_user_id
    )
    # NULL worker scope = unscoped passthrough: the frozen scope stands, nothing to narrow.
    if worker_scope is None:
        return _delivered_plan(run, gateway)
    version = await store.get_version(db, run.workflow_version_id)
    if version is None:  # pragma: no cover - pinned versions are immutable
        return _delivered_plan(run, gateway)
    # Intersect EACH slot's own grant with the worker allowlist so a slot narrowed
    # at StartRun keeps its narrowing and gains no namespace it was not granted.
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
        return _delivered_plan(run, gateway)
    await store.refreeze_run_gateway_token_scope(
        db, workflow_run_id=run.id, scope_json=new_scope_json
    )
    gateway = dict(gateway)
    gateway["integrations"] = intersected_union
    envelope["gateway"] = gateway
    await store.update_run(db, run_id=run.id, private_envelope_json=envelope)
    return _delivered_plan(run, gateway)


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
    """Lenient reconciliation: refresh is a reconciling *read* (not the sequential
    ``/status`` report), so it skips the strict transition guard but still refuses to
    overwrite a run the server already considers terminal."""

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

    # Terminal via the reconcile path expires the per-run gateway token too
    # (idempotent — a later report/refresh that also sees terminal is a no-op).
    if is_terminal(updated.status):
        await store.expire_run_gateway_tokens_for_run(db, workflow_run_id=run_id)

    await _run_step_actions(db, updated)
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
        # Executor unreachable this refresh: mark execution health SUSPECT on the
        # server-owned axis (§8.1) — NEVER touches observed_* (the last runtime
        # observation stands; orphaned escalation is a later lease-expiry concern).
        await store.update_run(
            db, run_id=run.id, execution_health=WORKFLOW_EXECUTION_HEALTH_SUSPECT
        )
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
    run (``authorize_run_ping`` already proved the token matches ``run_id``).
    Local-lane runs are observed by the desktop relay, so this no-ops for them; a
    failed refresh never changes engine state (the phase-3 sweep is the backstop).
    """

    run = await store.get_run(db, run_id)
    if run is None or run.target_mode != WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        return
    with contextlib.suppress(CloudApiError):
        await refresh_cloud_run(db, actor, run)


# --- take-over / cancel (D15) --------------------------------------------------


_PREACCEPT_UNCLAIMED_STATUSES = frozenset(
    {WORKFLOW_RUN_STATUS_PENDING_DELIVERY, WORKFLOW_RUN_STATUS_CLAIMABLE}
)
# A session lease past mere reservation means an executor began installing it —
# the run is no longer safely pre-acceptance (§8.3 branch 2).
_LEASE_PREPARED_STATES = frozenset({"prepared", "claimed", "quiescing"})


async def _is_pre_acceptance(db: AsyncSession, run: WorkflowRunRecord) -> bool:
    """§8.3 branch 1 predicate: unclaimed (``pending_delivery``/``claimable`` with no
    runtime observation) AND no session lease past ``reserved``."""

    if run.status not in _PREACCEPT_UNCLAIMED_STATUSES or run.observed_state is not None:
        return False
    leases = await ledger.list_session_leases_for_run(db, run_id=run.id)
    return not any(lease.state in _LEASE_PREPARED_STATES for lease in leases)


async def cancel_run(db: AsyncSession, user: ActorIdentity, run_id: UUID) -> WorkflowRunRecord:
    """Take over / cancel a run (D15, §8.3). Two branches by delivery evidence:

    **Branch 1 — pre-acceptance** (unclaimed, no lease prepared): one transaction
    sets desired ``cancel_requested`` + ``cancelled_before_acceptance``, invalidates
    the delivery offer (outbox), releases reservation-only leases, and lands legacy
    ``cancelled`` — quiescence is vacuous, so NO runtime observation is fabricated
    (``observed_*`` stays NULL) and no nudge is sent.

    **Branch 2 — claimed/delivered/lease prepared**: today's behavior (terminal
    ``cancelled`` + expire token + step actions + best-effort nudge) PLUS the durable
    §8.3 truth — desired ``cancel_requested`` and a ``workflow_control_command``
    (kind=cancel) the runtime consumes (WS7). The terminal write IS the release
    (C13 / L17).
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

    # --- Branch 1: pre-acceptance cancellation (§8.3) --------------------------
    if await _is_pre_acceptance(db, locked):
        updated = await store.update_run(
            db,
            run_id=run_id,
            status=WORKFLOW_RUN_STATUS_CANCELLED,
            finished_at=now if locked.finished_at is None else None,
            stopped_by_user_id=user.id,
            desired_state=WORKFLOW_DESIRED_STATE_CANCEL_REQUESTED,
            preaccept_cancel_state=WORKFLOW_PREACCEPT_CANCEL_CANCELLED,
            # Deliberately NO observed_state write — quiescence is vacuous; no
            # runtime ever started, so no observation is fabricated.
        )
        assert updated is not None
        # Invalidate the delivery offer so no relay can hand the plan over later,
        # and release reservation-only leases (never a prepared/claimed one — the
        # predicate already excluded those).
        await ledger.invalidate_run_outbox(db, run_id=run_id)
        for lease in await ledger.list_session_leases_for_run(db, run_id=run_id):
            if lease.state == "reserved":
                await ledger.transition_session_lease(db, lease_id=lease.id, state="released")
        await store.expire_run_gateway_tokens_for_run(db, workflow_run_id=run_id)
        await _run_step_actions(db, updated)
        return updated

    # --- Branch 2: claimed / delivered / lease prepared (§8.3) -----------------
    updated = await store.update_run(
        db,
        run_id=run_id,
        status=WORKFLOW_RUN_STATUS_CANCELLED,
        finished_at=now if locked.finished_at is None else None,
        stopped_by_user_id=user.id,
        desired_state=WORKFLOW_DESIRED_STATE_CANCEL_REQUESTED,
    )
    assert updated is not None

    # Durable cancel command (§8.3): the runtime consumes it (WS7) to stop turns
    # and report a quiescent cancellation. It exists now regardless of the nudge.
    await ledger.enqueue_control_command(
        db,
        run_id=run_id,
        kind="cancel",
        reason="user_takeover",
        plan_hash=locked.plan_hash,
        binding_hash=locked.binding_hash,
        execution_generation=locked.execution_generation,
    )

    # Shared terminal side effects (reused from report_run_status): expire the
    # per-run token before applying step actions so a crash mid-actions still
    # leaves the token dead.
    await store.expire_run_gateway_tokens_for_run(db, workflow_run_id=run_id)
    await _run_step_actions(db, updated)

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
