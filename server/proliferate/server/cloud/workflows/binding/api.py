"""Authenticated, fenced materialization-offer and binding-acceptance routes."""

from __future__ import annotations

from contextlib import suppress
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.binding.access import (
    BindingActor,
    authenticate_binding_actor,
)
from proliferate.server.cloud.workflows.binding.models import (
    AcceptExecutionBindingRequest,
    CreateMaterializationOfferRequest,
    ExecutionBindingAcceptanceResponse,
    ExecutionBindingStatusResponse,
    MaterializationOffer,
)
from proliferate.server.cloud.workflows.binding.service import (
    accept_execution_binding,
    get_execution_binding_status,
    issue_materialization_offer,
)

router = APIRouter()


async def _commit_binding_transaction(db: AsyncSession) -> None:
    try:
        await db.commit()
    except Exception as exc:
        # The response must remain a typed no-store failure even when the broken
        # connection cannot execute a second command.
        with suppress(Exception):
            await db.rollback()
        raise CloudApiError(
            "workflow_binding_commit_failed",
            "Workflow binding persistence did not commit.",
            status_code=503,
        ) from exc


@router.post(
    "/runs/{run_id}/materialization-offer",
    response_model=MaterializationOffer,
    response_model_exclude_none=True,
)
async def create_materialization_offer_endpoint(
    run_id: UUID,
    body: CreateMaterializationOfferRequest,
    db: AsyncSession = Depends(get_async_session),
    actor: BindingActor = Depends(authenticate_binding_actor),
) -> MaterializationOffer:
    """Mint the one-purpose binding credential; no execution credentials."""

    offer = await issue_materialization_offer(
        db,
        actor,
        run_id=run_id,
        executor_id=body.executor_id,
        claim_id=UUID(body.claim_id) if body.claim_id is not None else None,
    )
    await _commit_binding_transaction(db)
    return offer


@router.post(
    "/runs/{run_id}/execution-binding",
    response_model=ExecutionBindingAcceptanceResponse,
    response_model_exclude_none=True,
)
async def accept_execution_binding_endpoint(
    run_id: UUID,
    body: AcceptExecutionBindingRequest,
    materialization_credential: Annotated[
        str,
        Header(alias="X-Proliferate-Workflow-Materialization"),
    ],
    db: AsyncSession = Depends(get_async_session),
    actor: BindingActor = Depends(authenticate_binding_actor),
) -> ExecutionBindingAcceptanceResponse:
    """Accept exactly one canonical redacted binding under its fenced offer."""

    accepted = await accept_execution_binding(
        db,
        actor,
        run_id=run_id,
        request=body,
        materialization_credential=materialization_credential,
    )
    await _commit_binding_transaction(db)
    return accepted


@router.get(
    "/runs/{run_id}/execution-binding",
    response_model=ExecutionBindingStatusResponse,
    response_model_exclude_none=True,
)
async def get_execution_binding_endpoint(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    actor: BindingActor = Depends(authenticate_binding_actor),
) -> ExecutionBindingStatusResponse:
    """Recover an exact committed binding after a lost acceptance response."""

    return await get_execution_binding_status(db, actor, run_id=run_id)
