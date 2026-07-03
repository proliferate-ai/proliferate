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

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.workflows import (
    WORKFLOW_CLOUD_DELIVERY_TIMEOUT_SECONDS,
    WORKFLOW_CLOUD_REFRESH_TIMEOUT_SECONDS,
    WORKFLOW_DELIVERY_ERROR_CODE,
    WORKFLOW_RUN_OBSERVABLE_STATUSES,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_RUN_STATUS_RUNNING,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
)
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store.cloud_workflows import WorkflowRunRecord
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.workflow_runs import (
    deliver_workflow_run,
    read_workflow_run,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.gateway.service import ensure_cloud_sandbox_gateway_access
from proliferate.server.cloud.workflows.domain.run_status import is_terminal
from proliferate.server.cloud.workflows.service import mark_run_delivered
from proliferate.utils.time import utcnow

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

    try:
        access = await ensure_cloud_sandbox_gateway_access(db, user)
        await deliver_workflow_run(
            access.upstream_base_url,
            access.upstream_token,
            plan=run.resolved_plan_json,
            workspace_id=workspace_id,
            timeout=WORKFLOW_CLOUD_DELIVERY_TIMEOUT_SECONDS,
        )
    except (CloudApiError, CloudRuntimeReconnectError) as exc:
        message = exc.message if isinstance(exc, CloudApiError) else str(exc)
        return await _record_delivery_failure(db, run.id, message)

    return await mark_run_delivered(db, user, run.id)


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
