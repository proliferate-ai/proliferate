from __future__ import annotations

from typing import TYPE_CHECKING, NoReturn
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import PolicyDenied
from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_workspaces import (
    get_cloud_workspace_by_id,
    load_cloud_workspace_by_id,
)
from proliferate.server.cloud.claims.access import (
    load_workspace_exposure_and_claim,
    require_workspace_archive,
    require_workspace_interact,
    require_workspace_view,
)
from proliferate.server.cloud.errors import CloudApiError

if TYPE_CHECKING:
    from proliferate.db.models.cloud.workspaces import CloudWorkspace


def _raise_policy_denied(verdict: PolicyDenied) -> NoReturn:
    raise CloudApiError(verdict.code, verdict.message, status_code=verdict.status_code)


def _raise_workspace_not_found() -> NoReturn:
    _raise_policy_denied(
        PolicyDenied(
            code="workspace_not_found",
            message="Cloud workspace not found.",
            status_code=404,
        )
    )


async def cloud_workspace_user_can_read(
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace:
    # Transitional: the cloud workspace service still consumes ORM objects.
    # Keep lookup/policy ownership here until the store returns snapshots.
    async with db_engine.async_session_factory() as db:
        workspace = await load_cloud_workspace_by_id(db, workspace_id)
        if workspace is None:
            _raise_workspace_not_found()
        exposure, _claim = await load_workspace_exposure_and_claim(
            db,
            target_id=workspace.target_id,
            cloud_workspace_id=workspace.id,
        )
        await require_workspace_view(
            db,
            actor_user_id=user_id,
            owner_scope=workspace.owner_scope,
            owner_user_id=workspace.owner_user_id,
            organization_id=workspace.organization_id,
            exposure=exposure,
        )
    return workspace


async def cloud_workspace_user_can_read_with_db(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace:
    # Transitional: the cloud workspace service still consumes ORM objects.
    # Keep lookup/policy ownership here until the store returns snapshots.
    workspace = await get_cloud_workspace_by_id(db, workspace_id)
    if workspace is None:
        _raise_workspace_not_found()

    exposure, _claim = await load_workspace_exposure_and_claim(
        db,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
    )
    await require_workspace_view(
        db,
        actor_user_id=user_id,
        owner_scope=workspace.owner_scope,
        owner_user_id=workspace.owner_user_id,
        organization_id=workspace.organization_id,
        exposure=exposure,
    )
    return workspace


async def cloud_workspace_user_can_interact_with_db(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace:
    workspace = await get_cloud_workspace_by_id(db, workspace_id)
    if workspace is None:
        _raise_workspace_not_found()
    exposure, _claim = await load_workspace_exposure_and_claim(
        db,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
    )
    await require_workspace_interact(
        db,
        actor_user_id=user_id,
        owner_scope=workspace.owner_scope,
        owner_user_id=workspace.owner_user_id,
        organization_id=workspace.organization_id,
        workspace_archived=workspace.archived_at is not None,
        exposure=exposure,
    )
    return workspace


async def cloud_workspace_user_can_interact(
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace:
    async with db_engine.async_session_factory() as db:
        return await cloud_workspace_user_can_interact_with_db(db, user_id, workspace_id)


async def cloud_workspace_user_can_archive_with_db(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace:
    workspace = await get_cloud_workspace_by_id(db, workspace_id)
    if workspace is None:
        _raise_workspace_not_found()
    exposure, _claim = await load_workspace_exposure_and_claim(
        db,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
    )
    await require_workspace_archive(
        db,
        actor_user_id=user_id,
        owner_scope=workspace.owner_scope,
        owner_user_id=workspace.owner_user_id,
        organization_id=workspace.organization_id,
        workspace_archived=workspace.archived_at is not None,
        exposure=exposure,
    )
    return workspace


async def cloud_workspace_user_can_archive(
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace:
    async with db_engine.async_session_factory() as db:
        return await cloud_workspace_user_can_archive_with_db(db, user_id, workspace_id)
