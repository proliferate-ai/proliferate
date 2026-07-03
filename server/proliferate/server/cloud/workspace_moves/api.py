"""HTTP routes for workspace moves (local<->cloud round-trip handoff)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.workspace_moves.models import (
    ExportWorkspaceMoveResponse,
    FailWorkspaceMoveRequest,
    InstallWorkspaceMoveRequest,
    StartWorkspaceMoveRequest,
    WorkspaceMoveResponse,
)
from proliferate.server.cloud.workspace_moves.service import (
    complete_workspace_move,
    cutover_workspace_move,
    export_workspace_move_archive,
    fail_workspace_move,
    get_workspace_move_for_user,
    install_workspace_move_archive,
    start_workspace_move,
)

router = APIRouter(tags=["cloud-workspace-move"])


@router.post("/workspace-moves", response_model=WorkspaceMoveResponse)
async def start_workspace_move_endpoint(
    body: StartWorkspaceMoveRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceMoveResponse:
    try:
        return await start_workspace_move(db, user, body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("/workspace-moves/{move_id}", response_model=WorkspaceMoveResponse)
async def get_workspace_move_endpoint(
    move_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceMoveResponse:
    try:
        return await get_workspace_move_for_user(db, user, move_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/workspace-moves/{move_id}/install", response_model=WorkspaceMoveResponse)
async def install_workspace_move_endpoint(
    move_id: UUID,
    body: InstallWorkspaceMoveRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceMoveResponse:
    try:
        return await install_workspace_move_archive(db, user, move_id, body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/workspace-moves/{move_id}/export", response_model=ExportWorkspaceMoveResponse)
async def export_workspace_move_endpoint(
    move_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> ExportWorkspaceMoveResponse:
    try:
        return await export_workspace_move_archive(db, user, move_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/workspace-moves/{move_id}/cutover", response_model=WorkspaceMoveResponse)
async def cutover_workspace_move_endpoint(
    move_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceMoveResponse:
    try:
        return await cutover_workspace_move(db, user, move_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/workspace-moves/{move_id}/complete", response_model=WorkspaceMoveResponse)
async def complete_workspace_move_endpoint(
    move_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceMoveResponse:
    try:
        return await complete_workspace_move(db, user, move_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/workspace-moves/{move_id}/fail", response_model=WorkspaceMoveResponse)
async def fail_workspace_move_endpoint(
    move_id: UUID,
    body: FailWorkspaceMoveRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceMoveResponse:
    try:
        return await fail_workspace_move(db, user, move_id, body)
    except CloudApiError as error:
        raise_cloud_error(error)
