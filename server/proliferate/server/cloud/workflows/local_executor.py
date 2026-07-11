"""Server-side claim plane for the desktop workflow executor (track 2a).

Lifts L15: a due LOCAL schedule trigger fires a ``claimable`` run (see
``service.start_run``) that a desktop executor claims here, executes on its own
runtime, and relays through the existing ``/runs/{id}/status`` path (claim IS the
local delivery — there is no server-side delivery for this lane). Ports the
automations claim machinery (``automations/local_executor.py``): a 10s claim poll,
a 30s heartbeat that renews the TTL, and reclaim of a stale (laptop-closed) claim.

Auth is the desktop's existing user session (``current_product_user``); every
query is owner-scoped (``executor_user_id == user.id``), so a claim can only touch
the caller's own runs.

TRAP (mental-model §11): the automations executor's TS-SDK session path bypasses
the Rust forced-bypass policy. This module only hands the resolved plan to the
desktop; the desktop MUST deliver it through the runtime's own plan-delivery path
(so ``ensure_session`` forced-bypass applies) rather than opening a TS-SDK session.
That is a phase-2 (desktop) obligation — recorded here so the wiring keeps it.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    WORKFLOW_LOCAL_CLAIM_MAX_LIMIT,
    WORKFLOW_LOCAL_CLAIM_TTL_SECONDS,
)
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store.cloud_workflows import WorkflowRunRecord
from proliferate.server.cloud.workflows.gateway_grants import (
    resolve_run_scope,
    rotate_run_gateway_token,
)
from proliferate.server.cloud.workflows.models import (
    LocalWorkflowClaimActionRequest,
    LocalWorkflowClaimListResponse,
    LocalWorkflowClaimMutationResponse,
    LocalWorkflowClaimRequest,
    run_payload,
)
from proliferate.utils.time import utcnow


def _claim_ttl() -> timedelta:
    return timedelta(seconds=WORKFLOW_LOCAL_CLAIM_TTL_SECONDS)


async def claim_local_workflow_runs(
    db: AsyncSession,
    user_id: UUID,
    body: LocalWorkflowClaimRequest,
) -> LocalWorkflowClaimListResponse:
    executor_id = body.executor_id.strip()
    if not executor_id:
        # A blank executor id would make heartbeats un-attributable; refuse cheaply.
        return LocalWorkflowClaimListResponse(runs=[])
    limit = max(1, min(body.limit, WORKFLOW_LOCAL_CLAIM_MAX_LIMIT))
    runs = await store.claim_local_workflow_runs(
        db,
        user_id=user_id,
        executor_id=executor_id[:255],
        claim_ttl=_claim_ttl(),
        limit=limit,
        now=utcnow(),
    )
    # Rotate the per-run gateway token on every claim/reclaim (BLOCKER fix): a
    # partitioned laptop whose run this claim just took over is left holding an
    # expired token, so its runtime is 401'd by the gateway AND the token-authed
    # /status path. The fresh token is embedded in the resolved plan handed to THIS
    # claimant, mirroring StartRun's mint+embed exactly.
    rotated = [await _rotate_claim_gateway_token(db, run) for run in runs]
    # include_private_envelope: the desktop claimant delivers this plan to its own
    # runtime, so it must receive the (freshly-rotated) gateway block folded in.
    return LocalWorkflowClaimListResponse(
        runs=[run_payload(r, include_private_envelope=True) for r in rotated]
    )


async def _rotate_claim_gateway_token(
    db: AsyncSession, run: WorkflowRunRecord
) -> WorkflowRunRecord:
    """Rotate the claimed run's gateway token and fold the fresh block into the
    PRIVATE envelope this claimant receives (WS2b: never the logical plan). Scope is
    recomputed from the pinned version's definition, exactly as StartRun resolves it,
    so a reclaim never widens or narrows the grant."""

    version = await store.get_version(db, run.workflow_version_id)
    scope = resolve_run_scope(version.definition_json) if version is not None else {}
    _token, gateway_block = await rotate_run_gateway_token(
        db, run_id=run.id, owner_user_id=run.executor_user_id, scope=scope
    )
    updated = await store.update_run(
        db, run_id=run.id, private_envelope_json={"gateway": gateway_block}
    )
    return updated if updated is not None else run


async def heartbeat_local_workflow_run(
    db: AsyncSession,
    user_id: UUID,
    run_id: UUID,
    body: LocalWorkflowClaimActionRequest,
) -> LocalWorkflowClaimMutationResponse:
    run = await store.heartbeat_local_workflow_run(
        db,
        run_id=run_id,
        claim_id=body.claim_id,
        user_id=user_id,
        claim_ttl=_claim_ttl(),
        now=utcnow(),
    )
    return LocalWorkflowClaimMutationResponse(
        run=run_payload(run, include_private_envelope=True) if run is not None else None,
        accepted=run is not None,
    )
