"""Runtime/executor-facing control-channel routes (WS3b + desktop claim plane).

These endpoints are NOT product-user CRUD: they are the runtime's/executor's
authenticated control channel. Split out of ``workflows.api`` so the audience-
enforced credential surface lives beside the desktop claim plane it shares an
auth model with, and so ``api.py`` stays within its size budget.

* per-slot integration-credential exchange / install-ACK / rotation (feature
  spec §5.3), authenticated by the run's ``run_report``/``delivery_claim``
  control-channel credential;
* the desktop local-lane claim (user session) + heartbeat (delivery-claim
  credential or user session) endpoints, moved verbatim from ``api.py``.

Registered BEFORE the ``/{workflow_id}`` param routes' router so the literal
``/runs/{run_id}/credentials/...`` and ``/executor/...`` paths are matched first.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.workflows.access import (
    RunTokenActor,
    authorize_control_channel,
    authorize_delivery_claim,
    require_workflows_enabled,
)
from proliferate.server.cloud.workflows.credential_exchange import (
    IssuedCredential,
    acknowledge_install,
    exchange_slot_credential,
    rotate_slot_credential,
)
from proliferate.server.cloud.workflows.local_executor import (
    claim_local_workflow_runs,
    heartbeat_local_workflow_run,
)
from proliferate.server.cloud.workflows.models import (
    LocalWorkflowClaimActionRequest,
    LocalWorkflowClaimListResponse,
    LocalWorkflowClaimMutationResponse,
    LocalWorkflowClaimRequest,
    WorkflowBaseModel,
)

router = APIRouter(
    prefix="/workflows",
    tags=["cloud-workflows"],
    dependencies=[Depends(require_workflows_enabled)],
)


# --- credential exchange / ACK / rotation (feature spec §5.3) ------------------


class CredentialExchangeRequest(WorkflowBaseModel):
    """Exchange a per-slot one-use handle for a session-bound integration credential."""

    handle: str
    session_id: str = Field(alias="sessionId")


class CredentialAckRequest(WorkflowBaseModel):
    """Acknowledge the runtime installed the credential (consume the handle)."""

    handle: str
    session_id: str = Field(alias="sessionId")


class CredentialRotateRequest(WorkflowBaseModel):
    """Rotate the presented integration credential to its next generation."""

    credential: str
    generation: int


class CredentialResponse(WorkflowBaseModel):
    authorization: str
    audience: str
    generation: int
    slot_id: str = Field(alias="slotId")
    session_id: str = Field(alias="sessionId")
    expires_at: str = Field(alias="expiresAt")


def _credential_payload(issued: IssuedCredential) -> CredentialResponse:
    return CredentialResponse(
        authorization=issued.authorization,
        audience=issued.audience,
        generation=issued.generation,
        slot_id=issued.slot_id,
        session_id=issued.session_id,
        expires_at=issued.expires_at,
    )


@router.post("/runs/{run_id}/credentials/exchange", response_model=CredentialResponse)
async def exchange_credential_endpoint(
    run_id: UUID,
    body: CredentialExchangeRequest,
    db: AsyncSession = Depends(get_async_session),
    actor: RunTokenActor = Depends(authorize_control_channel),
) -> CredentialResponse:
    """§5.3: over the authenticated control channel, exchange a one-use handle for
    a short-lived integration credential bound to run/plan-hash/generation/slot/
    session. Durable-before-response; identical unacknowledged retry → same
    generation; wrong-session/post-ACK reuse denied."""

    issued = await exchange_slot_credential(
        db,
        run_id=run_id,
        owner_user_id=actor.id,
        handle=body.handle,
        session_id=body.session_id,
    )
    return _credential_payload(issued)


@router.post("/runs/{run_id}/credentials/ack", status_code=204)
async def ack_credential_endpoint(
    run_id: UUID,
    body: CredentialAckRequest,
    db: AsyncSession = Depends(get_async_session),
    _actor: RunTokenActor = Depends(authorize_control_channel),
) -> None:
    """§5.3: the runtime confirms it installed the credential — consume the handle
    and close any bounded rotation-overlap by revoking superseded generations."""

    await acknowledge_install(db, run_id=run_id, handle=body.handle, session_id=body.session_id)


@router.post("/runs/{run_id}/credentials/rotate", response_model=CredentialResponse)
async def rotate_credential_endpoint(
    run_id: UUID,
    body: CredentialRotateRequest,
    db: AsyncSession = Depends(get_async_session),
    actor: RunTokenActor = Depends(authorize_control_channel),
) -> CredentialResponse:
    """§5.3: rotate the presented integration credential to its next generation
    (scope unchanged); the old generation stays valid until the runtime ACKs."""

    issued = await rotate_slot_credential(
        db,
        run_id=run_id,
        owner_user_id=actor.id,
        presented_token=body.credential,
        generation=body.generation,
    )
    return _credential_payload(issued)


# --- desktop executor claim plane (track 2a; moved verbatim from api.py) -------
# Auth = the desktop's user session for the batch claim (no run scope yet); every
# claim is owner-scoped in the service, so a session can only claim its own local
# runs. The per-run heartbeat additionally accepts the run's delivery-claim
# credential and denies a wrong-audience token (WS3b).


@router.post("/executor/local/claims", response_model=LocalWorkflowClaimListResponse)
async def claim_local_workflow_runs_endpoint(
    body: LocalWorkflowClaimRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> LocalWorkflowClaimListResponse:
    """Claim a batch of this owner's ``claimable`` (or stale-reclaimable) local
    scheduled runs for a desktop executor (the 10s claim poll)."""

    return await claim_local_workflow_runs(db, user.id, body)


@router.post(
    "/executor/local/runs/{run_id}/heartbeat",
    response_model=LocalWorkflowClaimMutationResponse,
)
async def heartbeat_local_workflow_run_endpoint(
    run_id: UUID,
    body: LocalWorkflowClaimActionRequest,
    db: AsyncSession = Depends(get_async_session),
    # WS3b: the delivery-claim credential (a device cannot replay another
    # audience's token here) OR the desktop's user session.
    actor: RunTokenActor | User = Depends(authorize_delivery_claim),
) -> LocalWorkflowClaimMutationResponse:
    """Renew a live claim's TTL (the 30s heartbeat). ``accepted=false`` means the
    claim was lost (reclaimed / terminal / expired) and the executor must stop."""

    return await heartbeat_local_workflow_run(db, actor.id, run_id, body)
