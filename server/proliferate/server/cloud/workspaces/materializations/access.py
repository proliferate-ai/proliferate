"""Route access dependencies for local workspace materializations."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.db.store import cloud_workspace_materializations as materialization_store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store.cloud_workspace_materializations import (
    CloudWorkspaceMaterializationValue,
)
from proliferate.db.store.cloud_workspaces import CloudWorkspaceValue
from proliferate.server.api_errors import CloudApiError
from proliferate.server.cloud.workspaces.models import CreateMaterializationIntentRequest


@dataclass(frozen=True)
class CreateLocalMaterializationAccess:
    actor_user_id: UUID
    workspace: CloudWorkspaceValue
    desktop_install_id: str


@dataclass(frozen=True)
class ExistingLocalMaterializationAccess:
    actor_user_id: UUID
    workspace: CloudWorkspaceValue
    materialization: CloudWorkspaceMaterializationValue


async def _load_user_workspace(
    db: AsyncSession,
    *,
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspaceValue:
    workspace = await cloud_workspace_store.get_cloud_workspace_for_user(
        db,
        user_id,
        workspace_id,
    )
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)
    return workspace


async def _require_owned_install(
    db: AsyncSession,
    *,
    user_id: UUID,
    desktop_install_id: str,
) -> None:
    worker = await runtime_workers_store.get_active_desktop_worker_for_user(
        db,
        owner_user_id=user_id,
        desktop_install_id=desktop_install_id,
    )
    if worker is None:
        raise CloudApiError(
            "desktop_install_not_owned",
            "This desktop installation is not registered to your account.",
            status_code=403,
        )


async def _load_local_materialization(
    db: AsyncSession,
    *,
    workspace: CloudWorkspaceValue,
    materialization_id: UUID,
    operation: str,
) -> CloudWorkspaceMaterializationValue:
    materialization = await materialization_store.load_materialization(
        db,
        materialization_id,
        lock_row=True,
    )
    if materialization is None or materialization.cloud_workspace_id != workspace.id:
        raise CloudApiError(
            "materialization_not_found",
            "Materialization not found.",
            status_code=404,
        )
    if materialization.target_kind != "local_desktop":
        if operation == "report":
            raise CloudApiError(
                "materialization_not_reportable",
                "Only local materializations can be reported.",
                status_code=409,
            )
        raise CloudApiError(
            "materialization_not_unlinkable",
            "Only local materializations can be unlinked.",
            status_code=409,
        )
    return materialization


async def create_local_materialization_access(
    workspace_id: UUID,
    body: CreateMaterializationIntentRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CreateLocalMaterializationAccess:
    workspace = await _load_user_workspace(db, user_id=user.id, workspace_id=workspace_id)
    if workspace.lost_at is not None:
        raise CloudApiError(
            "workspace_lost",
            "This workspace was lost with its sandbox. Delete it instead of rematerializing it.",
            status_code=409,
        )
    desktop_install_id = body.desktop_install_id.strip()
    if not desktop_install_id:
        raise CloudApiError(
            "invalid_desktop_install",
            "A desktop installation id is required.",
            status_code=400,
        )
    await _require_owned_install(
        db,
        user_id=user.id,
        desktop_install_id=desktop_install_id,
    )
    return CreateLocalMaterializationAccess(
        actor_user_id=user.id,
        workspace=workspace,
        desktop_install_id=desktop_install_id,
    )


async def report_local_materialization_access(
    workspace_id: UUID,
    materialization_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> ExistingLocalMaterializationAccess:
    workspace = await _load_user_workspace(db, user_id=user.id, workspace_id=workspace_id)
    materialization = await _load_local_materialization(
        db,
        workspace=workspace,
        materialization_id=materialization_id,
        operation="report",
    )
    if materialization.desktop_install_id is not None:
        await _require_owned_install(
            db,
            user_id=user.id,
            desktop_install_id=materialization.desktop_install_id,
        )
    return ExistingLocalMaterializationAccess(
        actor_user_id=user.id,
        workspace=workspace,
        materialization=materialization,
    )


async def unlink_local_materialization_access(
    workspace_id: UUID,
    materialization_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> ExistingLocalMaterializationAccess:
    workspace = await _load_user_workspace(db, user_id=user.id, workspace_id=workspace_id)
    materialization = await _load_local_materialization(
        db,
        workspace=workspace,
        materialization_id=materialization_id,
        operation="unlink",
    )
    if materialization.unlinked_at is None and materialization.desktop_install_id is not None:
        await _require_owned_install(
            db,
            user_id=user.id,
            desktop_install_id=materialization.desktop_install_id,
        )
    return ExistingLocalMaterializationAccess(
        actor_user_id=user.id,
        workspace=workspace,
        materialization=materialization,
    )
