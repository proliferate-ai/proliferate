"""Worker-facing run delivery/observed-status orchestration (spec 3.2).

Owns the two mutations the *executor* side of a run drives: marking a
``pending_delivery`` run ``delivered`` once the plan has been handed off, and
recording the runtime's observed status reports (the cloud gateway refresh
path and the desktop local-lane relay both funnel through
:func:`report_run_status`).

Split out of ``service.py`` (ownership-only, WS0B-S): API-facing CRUD/
visibility stays in ``service.py``; StartRun compilation lives in
``compiler.py``; trigger CRUD/poll validation lives in ``triggers.py``. This is
the canonical ``server/<domain>/worker/service.py`` home for a domain's
worker-facing logic (see ``specs/codebase/structures/server/guides/background.md``).
"""

from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.workflows import (
    WORKFLOW_LOCAL_ACTIVE_CLAIM_STATUSES,
    WORKFLOW_RUN_OBSERVABLE_STATUSES,
    WORKFLOW_RUN_STATUS_DELIVERED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_RUN_STATUS_RUNNING,
    WORKFLOW_TARGET_MODE_LOCAL,
)
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store.cloud_workflows import WorkflowRunRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.domain.run_status import (
    RunTransitionError,
    check_transition,
    is_terminal,
)
from proliferate.server.cloud.workflows.models import RunStatusRequest
from proliferate.server.cloud.workflows.service import _visible_run
from proliferate.utils.time import utcnow

logger = logging.getLogger(__name__)


async def mark_run_delivered(
    db: AsyncSession, user: ActorIdentity, run_id: UUID
) -> WorkflowRunRecord:
    await _visible_run(db, user=user, run_id=run_id)
    locked = await store.lock_run(db, run_id)
    if locked is None:
        raise CloudApiError("workflow_run_not_found", "Workflow run not found.", status_code=404)
    # Idempotent: only the first pending_delivery -> delivered transition writes.
    if locked.status != WORKFLOW_RUN_STATUS_PENDING_DELIVERY:
        return locked
    updated = await store.update_run(
        db,
        run_id=run_id,
        status=WORKFLOW_RUN_STATUS_DELIVERED,
        delivered_at=utcnow(),
        # A landed delivery clears any prior delivery_failed marker from a retry.
        clear_error=True,
    )
    assert updated is not None
    return updated


def _parse_cost(value: float | None) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise CloudApiError(
            "invalid_cost", "cost_usd is not a valid amount.", status_code=400
        ) from exc


async def report_run_status(
    db: AsyncSession,
    user: ActorIdentity,
    run_id: UUID,
    body: RunStatusRequest,
    *,
    authed_via_run_token: bool = False,
) -> WorkflowRunRecord:
    await _visible_run(db, user=user, run_id=run_id)
    if body.status not in WORKFLOW_RUN_OBSERVABLE_STATUSES:
        raise CloudApiError(
            "invalid_run_status",
            f"status must be one of {sorted(WORKFLOW_RUN_OBSERVABLE_STATUSES)}.",
            status_code=400,
        )
    locked = await store.lock_run(db, run_id)
    if locked is None:
        raise CloudApiError("workflow_run_not_found", "Workflow run not found.", status_code=404)

    # Desktop-executor lane (2a) claim ownership. Token rotation at claim time
    # (local_executor.claim_local_workflow_runs) already 401s a reclaimed laptop's
    # runtime on the token-authed path. This closes the OTHER path: the desktop relay
    # reports observed state via OWNER auth, and the same user owns both laptops, so
    # the token check can't tell them apart. For a LOCAL run a desktop still holds a
    # live claim on (claimed/running/waiting_approval), an owner-authed report must
    # carry the CURRENT claim_id; a stale or missing one is rejected so laptop A's
    # relay can't clobber the run laptop B reclaimed. The runtime's own token-authed
    # self-report (authed_via_run_token) and every cloud run skip this — a cloud run
    # has no claim_id and its behavior is unchanged.
    if (
        not authed_via_run_token
        and locked.target_mode == WORKFLOW_TARGET_MODE_LOCAL
        and locked.claim_id is not None
        and locked.status in WORKFLOW_LOCAL_ACTIVE_CLAIM_STATUSES
    ):
        if body.claim_id is None:
            raise CloudApiError(
                "workflow_run_claim_required",
                "A claim id is required to report status on a claimed local run.",
                status_code=409,
            )
        if body.claim_id != locked.claim_id:
            raise CloudApiError(
                "workflow_run_stale_claim",
                "This claim no longer owns the run; it was reclaimed by another device.",
                status_code=409,
            )

    try:
        check_transition(locked.status, body.status)
    except RunTransitionError as exc:
        raise CloudApiError(exc.code, exc.message, status_code=409) from exc

    now = utcnow()
    started_at = (
        now if body.status == WORKFLOW_RUN_STATUS_RUNNING and locked.started_at is None else None
    )
    finished_at = now if is_terminal(body.status) and locked.finished_at is None else None

    updated = await store.update_run(
        db,
        run_id=run_id,
        status=body.status,
        step_cursor=body.step_cursor,
        step_outputs_json=body.step_outputs,
        error_code=body.error_code,
        error_message=body.error_message,
        anyharness_workspace_id=body.anyharness_workspace_id,
        anyharness_session_ids=body.anyharness_session_ids,
        cost_usd=_parse_cost(body.cost_usd),
        cost_tokens=body.cost_tokens,
        started_at=started_at,
        finished_at=finished_at,
    )
    assert updated is not None

    # Terminal status is the choke point that expires the per-run gateway token
    # (idempotent — an already-terminal run has no active token). Do this before
    # apply_step_actions so a crash mid-actions still leaves the token expired.
    if is_terminal(updated.status):
        await store.expire_run_gateway_tokens_for_run(db, workflow_run_id=run_id)

    try:
        from proliferate.server.cloud.workflows.actions import apply_step_actions

        await apply_step_actions(db, run=updated)
    except Exception:
        logger.exception("apply_step_actions failed run_id=%s", run_id)

    return updated
