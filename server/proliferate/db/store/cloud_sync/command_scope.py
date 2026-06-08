"""Cloud command target and workspace scope predicates."""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudCommandKind, CloudWorkspaceStatus
from proliferate.db.models.cloud.commands import CloudCommand
from proliferate.db.models.cloud.exposures import CloudWorkspaceExposure
from proliferate.db.models.cloud.targets import CloudTarget, CloudWorker
from proliferate.db.models.cloud.workspaces import CloudWorkspace


async def leased_target_is_stale(
    db: AsyncSession,
    row: CloudCommand,
    *,
    worker_id: UUID,
) -> bool:
    worker = await db.get(CloudWorker, worker_id)
    if worker is None:
        return True
    if worker.target_id != row.target_id:
        return True
    target = await db.get(CloudTarget, row.target_id)
    return target is None or target.archived_at is not None


async def command_requires_managed_workspace(db: AsyncSession, row: CloudCommand) -> bool:
    return command_requires_managed_workspace_for_target(
        kind=row.kind,
        payload_json=row.payload_json,
        target=await db.get(CloudTarget, row.target_id),
    )


def command_requires_managed_workspace_for_target(
    *,
    kind: str,
    payload_json: str | None,
    target: CloudTarget | None,
) -> bool:
    if not target_is_managed_cloud(target):
        return False
    if kind == CloudCommandKind.backfill_exposed_workspace.value:
        return True
    if kind != CloudCommandKind.materialize_workspace.value:
        return False
    return _materialize_workspace_mode(payload_json) != "existing_path"


def command_allows_cloud_workspace_scope(
    *,
    kind: str,
    payload_json: str | None,
) -> bool:
    return (
        kind != CloudCommandKind.materialize_workspace.value
        or _materialize_workspace_mode(payload_json) != "existing_path"
    )


def target_is_managed_cloud(target: CloudTarget | None) -> bool:
    return (
        target is not None
        and target.kind == "managed_cloud"
        and target.sandbox_profile_id is not None
        and target.profile_target_role == "primary"
        and target.archived_at is None
    )


def _materialize_workspace_mode(payload_json: str | None) -> str | None:
    try:
        payload = json.loads(payload_json or "{}")
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    mode = payload.get("mode")
    return mode if isinstance(mode, str) and mode else None


async def cloud_workspace_matches_command(db: AsyncSession, row: CloudCommand) -> bool:
    if row.cloud_workspace_id is None:
        return True
    workspace = await db.get(CloudWorkspace, row.cloud_workspace_id)
    if (
        workspace is None
        or workspace.archived_at is not None
        or not await workspace_matches_command_target(db, workspace=workspace, row=row)
    ):
        return False
    target = await db.get(CloudTarget, row.target_id)
    if target_is_managed_cloud(target):
        if workspace.sandbox_profile_id != target.sandbox_profile_id:
            return False
        exposure = await load_active_workspace_exposure(
            db,
            target_id=row.target_id,
            cloud_workspace_id=workspace.id,
        )
        can_rematerialize_pruned_workspace = (
            row.kind == CloudCommandKind.materialize_workspace.value
            and workspace.archived_at is None
            and workspace.anyharness_workspace_id is None
            and workspace.status == CloudWorkspaceStatus.needs_rematerialization.value
        )
        return (
            exposure is not None
            and exposure.status == "active"
            and (exposure.commandable or can_rematerialize_pruned_workspace)
        )
    return True


async def workspace_matches_command_target(
    db: AsyncSession,
    *,
    workspace: CloudWorkspace,
    row: CloudCommand,
) -> bool:
    if workspace.target_id is not None:
        return workspace.target_id == row.target_id
    return False


async def load_active_workspace_exposure(
    db: AsyncSession,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID,
) -> CloudWorkspaceExposure | None:
    return (
        await db.execute(
            select(CloudWorkspaceExposure)
            .where(CloudWorkspaceExposure.target_id == target_id)
            .where(CloudWorkspaceExposure.cloud_workspace_id == cloud_workspace_id)
            .where(CloudWorkspaceExposure.archived_at.is_(None))
            .limit(1)
        )
    ).scalar_one_or_none()
