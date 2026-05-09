"""Automation API routes."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.constants.automations import (
    AUTOMATION_RUN_LIST_DEFAULT_LIMIT,
    AUTOMATION_RUN_LIST_MAX_LIMIT,
)
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.automations.local_executor_service import (
    attach_local_run_session,
    attach_local_run_workspace,
    claim_local_runs,
    heartbeat_local_run,
    mark_local_run_creating_session,
    mark_local_run_creating_workspace,
    mark_local_run_dispatched,
    mark_local_run_dispatching,
    mark_local_run_failed,
    mark_local_run_provisioning_workspace,
)
from proliferate.server.automations.models import (
    AutomationListResponse,
    AutomationResponse,
    AutomationRunListResponse,
    AutomationRunResponse,
    CreateAutomationRequest,
    LocalAutomationAttachSessionRequest,
    LocalAutomationAttachWorkspaceRequest,
    LocalAutomationClaimActionRequest,
    LocalAutomationClaimListResponse,
    LocalAutomationClaimRequest,
    LocalAutomationFailRequest,
    LocalAutomationMutationResponse,
    UpdateAutomationRequest,
)
from proliferate.server.automations.service import (
    create_automation,
    get_automation,
    list_automation_runs,
    list_automations,
    pause_automation,
    resume_automation,
    run_automation_now,
    update_automation,
)

router = APIRouter(prefix="/automations", tags=["automations"])


@router.get("", response_model=AutomationListResponse)
async def list_automations_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> AutomationListResponse:
    return await list_automations(db, user.id)


@router.post("", response_model=AutomationResponse)
async def create_automation_endpoint(
    body: CreateAutomationRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> AutomationResponse:
    return await create_automation(db, user.id, body)


@router.post("/executor/local/claims", response_model=LocalAutomationClaimListResponse)
async def claim_local_runs_endpoint(
    body: LocalAutomationClaimRequest,
    user: User = Depends(current_active_user),
) -> LocalAutomationClaimListResponse:
    return await claim_local_runs(user.id, body)


@router.post(
    "/executor/local/runs/{run_id}/heartbeat",
    response_model=LocalAutomationMutationResponse,
)
async def heartbeat_local_run_endpoint(
    run_id: UUID,
    body: LocalAutomationClaimActionRequest,
    user: User = Depends(current_active_user),
) -> LocalAutomationMutationResponse:
    return await heartbeat_local_run(user.id, run_id, body)


@router.post(
    "/executor/local/runs/{run_id}/creating-workspace",
    response_model=LocalAutomationMutationResponse,
)
async def mark_local_run_creating_workspace_endpoint(
    run_id: UUID,
    body: LocalAutomationClaimActionRequest,
    user: User = Depends(current_active_user),
) -> LocalAutomationMutationResponse:
    return await mark_local_run_creating_workspace(user.id, run_id, body)


@router.post(
    "/executor/local/runs/{run_id}/attach-workspace",
    response_model=LocalAutomationMutationResponse,
)
async def attach_local_run_workspace_endpoint(
    run_id: UUID,
    body: LocalAutomationAttachWorkspaceRequest,
    user: User = Depends(current_active_user),
) -> LocalAutomationMutationResponse:
    return await attach_local_run_workspace(user.id, run_id, body)


@router.post(
    "/executor/local/runs/{run_id}/provisioning-workspace",
    response_model=LocalAutomationMutationResponse,
)
async def mark_local_run_provisioning_workspace_endpoint(
    run_id: UUID,
    body: LocalAutomationClaimActionRequest,
    user: User = Depends(current_active_user),
) -> LocalAutomationMutationResponse:
    return await mark_local_run_provisioning_workspace(user.id, run_id, body)


@router.post(
    "/executor/local/runs/{run_id}/creating-session",
    response_model=LocalAutomationMutationResponse,
)
async def mark_local_run_creating_session_endpoint(
    run_id: UUID,
    body: LocalAutomationAttachWorkspaceRequest,
    user: User = Depends(current_active_user),
) -> LocalAutomationMutationResponse:
    return await mark_local_run_creating_session(user.id, run_id, body)


@router.post(
    "/executor/local/runs/{run_id}/attach-session",
    response_model=LocalAutomationMutationResponse,
)
async def attach_local_run_session_endpoint(
    run_id: UUID,
    body: LocalAutomationAttachSessionRequest,
    user: User = Depends(current_active_user),
) -> LocalAutomationMutationResponse:
    return await attach_local_run_session(user.id, run_id, body)


@router.post(
    "/executor/local/runs/{run_id}/dispatching",
    response_model=LocalAutomationMutationResponse,
)
async def mark_local_run_dispatching_endpoint(
    run_id: UUID,
    body: LocalAutomationClaimActionRequest,
    user: User = Depends(current_active_user),
) -> LocalAutomationMutationResponse:
    return await mark_local_run_dispatching(user.id, run_id, body)


@router.post(
    "/executor/local/runs/{run_id}/dispatched",
    response_model=LocalAutomationMutationResponse,
)
async def mark_local_run_dispatched_endpoint(
    run_id: UUID,
    body: LocalAutomationAttachSessionRequest,
    user: User = Depends(current_active_user),
) -> LocalAutomationMutationResponse:
    return await mark_local_run_dispatched(user.id, run_id, body)


@router.post(
    "/executor/local/runs/{run_id}/failed",
    response_model=LocalAutomationMutationResponse,
)
async def mark_local_run_failed_endpoint(
    run_id: UUID,
    body: LocalAutomationFailRequest,
    user: User = Depends(current_active_user),
) -> LocalAutomationMutationResponse:
    return await mark_local_run_failed(user.id, run_id, body)


@router.get("/{automation_id}", response_model=AutomationResponse)
async def get_automation_endpoint(
    automation_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> AutomationResponse:
    return await get_automation(db, user.id, automation_id)


@router.patch("/{automation_id}", response_model=AutomationResponse)
async def update_automation_endpoint(
    automation_id: UUID,
    body: UpdateAutomationRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> AutomationResponse:
    return await update_automation(db, user.id, automation_id, body)


@router.post("/{automation_id}/pause", response_model=AutomationResponse)
async def pause_automation_endpoint(
    automation_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> AutomationResponse:
    return await pause_automation(db, user.id, automation_id)


@router.post("/{automation_id}/resume", response_model=AutomationResponse)
async def resume_automation_endpoint(
    automation_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> AutomationResponse:
    return await resume_automation(db, user.id, automation_id)


@router.post("/{automation_id}/run-now", response_model=AutomationRunResponse)
async def run_automation_now_endpoint(
    automation_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> AutomationRunResponse:
    return await run_automation_now(db, user.id, automation_id)


@router.get("/{automation_id}/runs", response_model=AutomationRunListResponse)
async def list_automation_runs_endpoint(
    automation_id: UUID,
    limit: Annotated[int, Query(ge=1, le=AUTOMATION_RUN_LIST_MAX_LIMIT)] = (
        AUTOMATION_RUN_LIST_DEFAULT_LIMIT
    ),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> AutomationRunListResponse:
    return await list_automation_runs(db, user.id, automation_id, limit=limit)
