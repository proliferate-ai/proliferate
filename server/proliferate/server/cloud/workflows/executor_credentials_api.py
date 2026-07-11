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

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.access import (
    RunTokenActor,
    authorize_control_channel,
    authorize_delivery_claim,
    require_workflows_enabled,
)
from proliferate.server.cloud.workflows.activation_receipts import (
    ActivationRecord,
    GatewayReceiptRecord,
    get_activation_and_receipt,
    list_receipts_for_gate,
)
from proliferate.server.cloud.workflows.activation_registration import register_activation
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


# --- required-invocation activation registration + receipt query (§7.3) -------
# Same control-channel auth as credential exchange: the runtime's own
# run_report/delivery_claim credential (or a legacy all-purpose token) — never
# an integration credential (that one calls tools, it does not register/query
# activations) and never an agent-supplied claim.


class ActivationRegisterRequest(WorkflowBaseModel):
    plan_hash: str = Field(alias="planHash")
    slot_id: str = Field(alias="slotId")
    session_id: str = Field(alias="sessionId")
    step_key: str = Field(alias="stepKey")
    attempt: int
    activation_id: str = Field(alias="activationId")
    capability_key: str = Field(alias="capabilityKey")
    turn_id: str | None = Field(default=None, alias="turnId")


class ActivationResponse(WorkflowBaseModel):
    activation_id: str = Field(alias="activationId")
    plan_hash: str = Field(alias="planHash")
    slot_id: str = Field(alias="slotId")
    session_id: str = Field(alias="sessionId")
    step_key: str = Field(alias="stepKey")
    attempt: int
    capability_key: str = Field(alias="capabilityKey")
    turn_id: str | None = Field(alias="turnId")
    created_at: str = Field(alias="createdAt")


class ReceiptResponse(WorkflowBaseModel):
    """§7.3: the receipt's full public shape — no arguments, headers, or
    secrets ever land in any of these fields (the schema itself has no column
    for them)."""

    activation_id: str = Field(alias="activationId")
    slot_id: str = Field(alias="slotId")
    session_id: str = Field(alias="sessionId")
    step_key: str = Field(alias="stepKey")
    attempt: int
    capability_kind: str = Field(alias="capabilityKind")
    provider_definition_id: str | None = Field(default=None, alias="providerDefinitionId")
    provider_revision: str | None = Field(default=None, alias="providerRevision")
    tool_name: str | None = Field(default=None, alias="toolName")
    function_definition_id: str | None = Field(default=None, alias="functionDefinitionId")
    semantic_revision: int | None = Field(default=None, alias="semanticRevision")
    authorization_decision: str = Field(alias="authorizationDecision")
    outcome: str
    created_at: str = Field(alias="createdAt")
    completed_at: str | None = Field(default=None, alias="completedAt")


class ActivationReceiptResponse(WorkflowBaseModel):
    activation: ActivationResponse
    receipt: ReceiptResponse | None = None


class ReceiptListResponse(WorkflowBaseModel):
    receipts: list[ReceiptResponse]


def _activation_payload(activation: ActivationRecord) -> ActivationResponse:
    return ActivationResponse(
        activationId=activation.activation_id,
        planHash=activation.plan_hash,
        slotId=activation.slot_id,
        sessionId=activation.session_id,
        stepKey=activation.step_key,
        attempt=activation.attempt,
        capabilityKey=activation.capability_key,
        turnId=activation.turn_id,
        createdAt=activation.created_at.isoformat(),
    )


def _receipt_payload(receipt: GatewayReceiptRecord) -> ReceiptResponse:
    return ReceiptResponse(
        activationId=receipt.activation_id,
        slotId=receipt.slot_id,
        sessionId=receipt.session_id,
        stepKey=receipt.step_key,
        attempt=receipt.attempt,
        capabilityKind=receipt.capability_kind,
        providerDefinitionId=receipt.provider_definition_id,
        providerRevision=receipt.provider_revision,
        toolName=receipt.tool_name,
        functionDefinitionId=receipt.function_definition_id,
        semanticRevision=receipt.semantic_revision,
        authorizationDecision=receipt.authorization_decision,
        outcome=receipt.outcome,
        createdAt=receipt.created_at.isoformat(),
        completedAt=receipt.completed_at.isoformat() if receipt.completed_at else None,
    )


@router.post("/runs/{run_id}/activations", response_model=ActivationResponse)
async def register_activation_endpoint(
    run_id: UUID,
    body: ActivationRegisterRequest,
    db: AsyncSession = Depends(get_async_session),
    _actor: RunTokenActor = Depends(authorize_control_channel),
) -> ActivationResponse:
    """§7.3: register a required-invocation activation BEFORE the agent turn
    starts. Durable-before-response; an identical retry (same activationId +
    identity) returns the same row, a conflicting reuse is a typed 409."""

    activation = await register_activation(
        db,
        run_id=run_id,
        plan_hash=body.plan_hash,
        slot_id=body.slot_id,
        session_id=body.session_id,
        step_key=body.step_key,
        attempt=body.attempt,
        activation_id=body.activation_id,
        capability_key=body.capability_key,
        turn_id=body.turn_id,
    )
    return _activation_payload(activation)


@router.get(
    "/runs/{run_id}/activations/{activation_id}",
    response_model=ActivationReceiptResponse,
)
async def get_activation_endpoint(
    run_id: UUID,
    activation_id: str,
    db: AsyncSession = Depends(get_async_session),
    _actor: RunTokenActor = Depends(authorize_control_channel),
) -> ActivationReceiptResponse:
    """§7.3 recovery: the runtime queries the authoritative record by activation
    identity. ``receipt: null`` means absent -> corrective re-prompt (within the
    frozen budget); a present receipt means complete (whatever its outcome)."""

    found = await get_activation_and_receipt(db, run_id=run_id, activation_id=activation_id)
    if found is None:
        raise CloudApiError(
            "workflow_activation_not_found",
            "No such activation for this run.",
            status_code=404,
        )
    activation, receipt = found
    return ActivationReceiptResponse(
        activation=_activation_payload(activation),
        receipt=_receipt_payload(receipt) if receipt is not None else None,
    )


@router.get("/runs/{run_id}/receipts", response_model=ReceiptListResponse)
async def list_receipts_endpoint(
    run_id: UUID,
    slot_id: str = Query(alias="slotId"),
    step_key: str = Query(alias="stepKey"),
    attempt: int = Query(),
    db: AsyncSession = Depends(get_async_session),
    _actor: RunTokenActor = Depends(authorize_control_channel),
) -> ReceiptListResponse:
    """§7.3: list every receipt for one (run, slot, step, attempt) — the exact
    input the runtime (or ``domain.gate.gate_satisfied`` server-side) evaluates
    to decide complete / corrective-re-prompt / exhausted."""

    receipts = await list_receipts_for_gate(
        db, run_id=run_id, slot_id=slot_id, step_key=step_key, attempt=attempt
    )
    return ReceiptListResponse(receipts=[_receipt_payload(receipt) for receipt in receipts])


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
