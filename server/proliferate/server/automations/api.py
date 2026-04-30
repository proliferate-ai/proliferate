"""Automation API routes."""

from __future__ import annotations

from typing import Annotated, NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.automations.models import (
    AutomationListResponse,
    AutomationResponse,
    AutomationRunListResponse,
    AutomationRunResponse,
    CreateAutomationRequest,
    UpdateAutomationRequest,
)
from proliferate.server.automations.service import (
    AutomationServiceError,
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


def _raise_automation_error(error: AutomationServiceError) -> NoReturn:
    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
    )


@router.get("", response_model=AutomationListResponse)
async def list_automations_endpoint(
    user: User = Depends(current_active_user),
) -> AutomationListResponse:
    try:
        return await list_automations(user.id)
    except AutomationServiceError as error:
        _raise_automation_error(error)


@router.post("", response_model=AutomationResponse)
async def create_automation_endpoint(
    body: CreateAutomationRequest,
    user: User = Depends(current_active_user),
) -> AutomationResponse:
    try:
        return await create_automation(user.id, body)
    except AutomationServiceError as error:
        _raise_automation_error(error)


@router.get("/{automation_id}", response_model=AutomationResponse)
async def get_automation_endpoint(
    automation_id: UUID,
    user: User = Depends(current_active_user),
) -> AutomationResponse:
    try:
        return await get_automation(user.id, automation_id)
    except AutomationServiceError as error:
        _raise_automation_error(error)


@router.patch("/{automation_id}", response_model=AutomationResponse)
async def update_automation_endpoint(
    automation_id: UUID,
    body: UpdateAutomationRequest,
    user: User = Depends(current_active_user),
) -> AutomationResponse:
    try:
        return await update_automation(user.id, automation_id, body)
    except AutomationServiceError as error:
        _raise_automation_error(error)


@router.post("/{automation_id}/pause", response_model=AutomationResponse)
async def pause_automation_endpoint(
    automation_id: UUID,
    user: User = Depends(current_active_user),
) -> AutomationResponse:
    try:
        return await pause_automation(user.id, automation_id)
    except AutomationServiceError as error:
        _raise_automation_error(error)


@router.post("/{automation_id}/resume", response_model=AutomationResponse)
async def resume_automation_endpoint(
    automation_id: UUID,
    user: User = Depends(current_active_user),
) -> AutomationResponse:
    try:
        return await resume_automation(user.id, automation_id)
    except AutomationServiceError as error:
        _raise_automation_error(error)


@router.post("/{automation_id}/run-now", response_model=AutomationRunResponse)
async def run_automation_now_endpoint(
    automation_id: UUID,
    user: User = Depends(current_active_user),
) -> AutomationRunResponse:
    try:
        return await run_automation_now(user.id, automation_id)
    except AutomationServiceError as error:
        _raise_automation_error(error)


@router.get("/{automation_id}/runs", response_model=AutomationRunListResponse)
async def list_automation_runs_endpoint(
    automation_id: UUID,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    user: User = Depends(current_active_user),
) -> AutomationRunListResponse:
    try:
        return await list_automation_runs(user.id, automation_id, limit=limit)
    except AutomationServiceError as error:
        _raise_automation_error(error)
