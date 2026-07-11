"""Server-side claim plane for the desktop workflow executor (track 2a).

Every LOCAL StartRun creates a ``claimable`` run that a desktop executor claims
here before materialization. Claim is the only local authority transition; there
is no manual/chat alternate delivery path and no server-side delivery. Ports the
automations claim machinery (``automations/local_executor.py``): a 10s claim poll,
a 30s heartbeat that renews the TTL, and reclaim of a stale (laptop-closed) claim.

Auth is the desktop's existing user session (``current_product_user``); every
query is owner-scoped (``executor_user_id == user.id``), so a claim can only touch
the caller's own runs.

TRAP (mental-model §11): the automations executor's TS-SDK session path bypasses
the Rust forced-bypass policy. This response remains public and credential-free;
after the later WF-CRED cutover the desktop must use the runtime's delivery path,
not open a TS-SDK session directly.
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
from proliferate.server.cloud.workflows.local_models import (
    LocalWorkflowClaimActionRequest,
    LocalWorkflowClaimListResponse,
    LocalWorkflowClaimMutationResponse,
    LocalWorkflowClaimRequest,
)
from proliferate.server.cloud.workflows.models import (
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
        workspace_id=body.workspace_id,
        workspace_generation=body.workspace_generation,
        claim_ttl=_claim_ttl(),
        limit=limit,
        now=utcnow(),
    )
    # Binding acceptance is necessary but not sufficient for runtime delivery.
    # WF-CRED later returns the final envelope; this claim response stays public
    # and credential-free and performs no gateway-token rotation.
    return LocalWorkflowClaimListResponse(runs=[run_payload(r) for r in runs])


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
        executor_id=body.executor_id.strip(),
        user_id=user_id,
        claim_ttl=_claim_ttl(),
        now=utcnow(),
    )
    return LocalWorkflowClaimMutationResponse(
        run=run_payload(run) if run is not None else None,
        accepted=run is not None,
    )
