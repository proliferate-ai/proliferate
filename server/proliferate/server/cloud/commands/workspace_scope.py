"""Cloud command workspace-scope resolution."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.cloud import CloudCommandKind, CloudWorkspaceStatus
from proliferate.db.store import cloud_runtime_environments, cloud_workspaces
from proliferate.db.store.cloud_sync import events as events_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.claims.access import require_workspace_interact
from proliferate.server.cloud.commands.domain.target import target_requires_cloud_workspace
from proliferate.server.cloud.commands.models import CreateCloudCommandRequest
from proliferate.server.cloud.commands.projected_sessions import (
    PROJECTED_SESSION_COMMAND_KINDS,
    resolve_projected_session_command_workspace,
)
from proliferate.server.cloud.errors import CloudApiError


async def resolve_command_workspace(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    target: targets_store.CloudTargetSnapshot,
    kind: str,
    body: CreateCloudCommandRequest,
) -> tuple[str | None, dict[str, object], str | None]:
    if (
        kind == CloudCommandKind.materialize_workspace.value
        and body.cloud_workspace_id is not None
        and not _materialize_payload_allows_cloud_workspace_scope(body.payload)
    ):
        raise CloudApiError(
            "cloud_command_cloud_workspace_not_allowed",
            "existing_path materialize_workspace commands cannot scope a Cloud workspace.",
            status_code=400,
        )
    if (
        kind == CloudCommandKind.materialize_workspace.value
        and target_requires_cloud_workspace(target)
        and _materialize_payload_requires_cloud_workspace(body.payload)
    ):
        if body.cloud_workspace_id is None:
            raise CloudApiError(
                "cloud_command_cloud_workspace_required",
                "Managed materialize_workspace commands require cloudWorkspaceId.",
                status_code=400,
            )
        cloud_workspace_id = await _resolve_cloud_workspace_id_for_target(
            db,
            target=target,
            cloud_workspace_id=body.cloud_workspace_id,
        )
        exposure = await exposures_store.get_active_workspace_exposure(
            db,
            target_id=target.id,
            cloud_workspace_id=UUID(cloud_workspace_id),
        )
        if exposure is None or exposure.archived_at is not None or exposure.status != "active":
            raise CloudApiError(
                "cloud_command_exposure_not_active",
                "Workspace is not exposed for Cloud materialization.",
                status_code=409,
            )
        workspace = await cloud_workspaces.get_cloud_workspace_by_id(
            db,
            UUID(cloud_workspace_id),
        )
        can_rematerialize_pruned_workspace = (
            workspace is not None
            and workspace.archived_at is None
            and workspace.anyharness_workspace_id is None
            and workspace.status == CloudWorkspaceStatus.needs_rematerialization.value
        )
        if not exposure.commandable and not can_rematerialize_pruned_workspace:
            raise CloudApiError(
                "cloud_command_exposure_not_commandable",
                "Workspace exposure is read-only.",
                status_code=409,
            )
        await require_workspace_interact(
            db,
            actor_user_id=user.id,
            owner_scope=exposure.owner_scope,
            owner_user_id=exposure.owner_user_id,
            organization_id=exposure.organization_id,
            workspace_archived=False,
            exposure=exposure,
        )
        return None, body.payload, cloud_workspace_id
    if kind in PROJECTED_SESSION_COMMAND_KINDS:
        return await resolve_projected_session_command_workspace(
            db,
            user=user,
            target=target,
            body=body,
        )
    if kind == CloudCommandKind.backfill_exposed_workspace.value:
        return await _resolve_backfill_exposed_workspace_command(
            db,
            user=user,
            target=target,
            body=body,
        )
    if kind == CloudCommandKind.prune_workspace_worktree.value:
        return await _resolve_prune_workspace_worktree_command(
            db,
            user=user,
            target=target,
            body=body,
        )
    if kind == CloudCommandKind.start_session.value and target_requires_cloud_workspace(target):
        if body.cloud_workspace_id is None and not body.workspace_id:
            raise CloudApiError(
                "cloud_command_cloud_workspace_required",
                "Managed start_session commands require cloudWorkspaceId.",
                status_code=400,
            )
        return await _resolve_managed_start_session_workspace(
            db,
            user=user,
            target=target,
            body=body,
        )
    if kind != CloudCommandKind.start_session.value:
        cloud_workspace_id = None
        if body.cloud_workspace_id is not None:
            cloud_workspace_id = await _resolve_cloud_workspace_id_for_target(
                db,
                target=target,
                cloud_workspace_id=body.cloud_workspace_id,
            )
        return body.workspace_id, body.payload, cloud_workspace_id
    if not body.workspace_id:
        workspace_id = direct_start_session_workspace_id(body.payload)
        if workspace_id is None:
            return None, body.payload, None
        return await _resolve_direct_start_session_workspace(
            db,
            user=user,
            target=target,
            body=body,
            workspace_id=workspace_id,
        )
    try:
        cloud_workspace_id = UUID(body.workspace_id or "")
    except ValueError as exc:
        raise CloudApiError(
            "cloud_command_workspace_not_found",
            "Start-session commands must reference a cloud workspace.",
            status_code=404,
        ) from exc

    workspace = await cloud_workspaces.get_cloud_workspace_for_user(
        db,
        user.id,
        cloud_workspace_id,
    )
    if workspace is None:
        raise CloudApiError(
            "cloud_command_workspace_not_found",
            "Workspace not found.",
            status_code=404,
        )
    if (
        workspace.status != CloudWorkspaceStatus.ready.value
        or not workspace.anyharness_workspace_id
    ):
        raise CloudApiError(
            "cloud_command_workspace_not_ready",
            "Workspace is not ready for cloud commands.",
            status_code=409,
        )
    if workspace.target_id is not None:
        if workspace.target_id != target.id:
            raise CloudApiError(
                "cloud_command_workspace_target_mismatch",
                "Workspace is not attached to the requested target.",
                status_code=409,
            )
    else:
        runtime_environment = (
            await cloud_runtime_environments.get_runtime_environment_for_workspace(
                db,
                workspace,
            )
        )
        if runtime_environment is None or runtime_environment.target_id != target.id:
            raise CloudApiError(
                "cloud_command_workspace_target_mismatch",
                "Workspace is not attached to the requested target.",
                status_code=409,
            )
    exposure = await exposures_store.get_active_workspace_exposure(
        db,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
    )
    if (
        exposure is None
        or exposure.archived_at is not None
        or exposure.status != "active"
        or not exposure.anyharness_workspace_id
    ):
        raise CloudApiError(
            "cloud_command_exposure_not_active",
            "Workspace is not exposed for Cloud commands.",
            status_code=409,
        )
    if not exposure.commandable:
        raise CloudApiError(
            "cloud_command_exposure_not_commandable",
            "Workspace exposure is read-only.",
            status_code=409,
        )
    await require_workspace_interact(
        db,
        actor_user_id=user.id,
        owner_scope=exposure.owner_scope,
        owner_user_id=exposure.owner_user_id,
        organization_id=exposure.organization_id,
        workspace_archived=workspace.archived_at is not None,
        exposure=exposure,
    )
    payload = dict(body.payload)
    payload["workspaceId"] = exposure.anyharness_workspace_id
    return exposure.anyharness_workspace_id, payload, str(workspace.id)


async def _resolve_direct_start_session_workspace(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    target: targets_store.CloudTargetSnapshot,
    body: CreateCloudCommandRequest,
    workspace_id: str,
) -> tuple[str | None, dict[str, object], str | None]:
    cloud_workspace_id = await events_store.resolve_cloud_workspace_id(
        db,
        target_id=target.id,
        workspace_id=workspace_id,
    )
    if cloud_workspace_id is None:
        raise CloudApiError(
            "cloud_command_exposure_not_active",
            "Workspace is not exposed for Cloud commands.",
            status_code=409,
        )
    exposure = await exposures_store.get_active_workspace_exposure(
        db,
        target_id=target.id,
        cloud_workspace_id=cloud_workspace_id,
    )
    if (
        exposure is None
        or exposure.archived_at is not None
        or exposure.status != "active"
        or not exposure.anyharness_workspace_id
    ):
        raise CloudApiError(
            "cloud_command_exposure_not_active",
            "Workspace is not exposed for Cloud commands.",
            status_code=409,
        )
    if not exposure.commandable:
        raise CloudApiError(
            "cloud_command_exposure_not_commandable",
            "Workspace exposure is read-only.",
            status_code=409,
        )
    await require_workspace_interact(
        db,
        actor_user_id=user.id,
        owner_scope=exposure.owner_scope,
        owner_user_id=exposure.owner_user_id,
        organization_id=exposure.organization_id,
        workspace_archived=False,
        exposure=exposure,
    )
    payload = dict(body.payload)
    payload["workspaceId"] = exposure.anyharness_workspace_id
    return exposure.anyharness_workspace_id, payload, str(cloud_workspace_id)


async def _resolve_managed_start_session_workspace(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    target: targets_store.CloudTargetSnapshot,
    body: CreateCloudCommandRequest,
) -> tuple[str | None, dict[str, object], str | None]:
    cloud_workspace_id = body.cloud_workspace_id
    if cloud_workspace_id is None:
        try:
            cloud_workspace_id = UUID(body.workspace_id or "")
        except ValueError as exc:
            raise CloudApiError(
                "cloud_command_workspace_not_found",
                "Managed start-session commands must reference a Cloud workspace.",
                status_code=404,
            ) from exc

    workspace = await cloud_workspaces.get_cloud_workspace_by_id(db, cloud_workspace_id)
    if workspace is None or workspace.archived_at is not None:
        raise CloudApiError(
            "cloud_command_workspace_not_found",
            "Workspace not found.",
            status_code=404,
        )
    if workspace.status != CloudWorkspaceStatus.ready.value:
        raise CloudApiError(
            "cloud_command_workspace_not_ready",
            "Workspace is not ready for cloud commands.",
            status_code=409,
        )
    if (
        workspace.target_id != target.id
        or workspace.sandbox_profile_id != target.sandbox_profile_id
        or workspace.owner_scope != target.owner_scope
        or workspace.owner_user_id != target.owner_user_id
        or workspace.organization_id != target.organization_id
    ):
        raise CloudApiError(
            "cloud_command_workspace_target_mismatch",
            "Workspace is not attached to the requested target.",
            status_code=409,
        )
    if workspace.sandbox_profile_id is None or workspace.target_id is None:
        raise CloudApiError(
            "cloud_command_workspace_target_missing",
            "Workspace is missing its managed sandbox profile target.",
            status_code=409,
        )
    if workspace.materialized_target_id != target.id:
        raise CloudApiError(
            "cloud_command_workspace_target_stale",
            "Workspace must be rematerialized on the active managed sandbox before commands run.",
            status_code=409,
        )
    exposure = await exposures_store.get_active_workspace_exposure(
        db,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
    )
    if (
        exposure is None
        or exposure.archived_at is not None
        or exposure.status != "active"
        or not exposure.anyharness_workspace_id
    ):
        raise CloudApiError(
            "cloud_command_exposure_not_active",
            "Workspace is not exposed for Cloud commands.",
            status_code=409,
        )
    if not exposure.commandable:
        raise CloudApiError(
            "cloud_command_exposure_not_commandable",
            "Workspace exposure is read-only.",
            status_code=409,
        )
    await require_workspace_interact(
        db,
        actor_user_id=user.id,
        owner_scope=workspace.owner_scope,
        owner_user_id=workspace.owner_user_id,
        organization_id=workspace.organization_id,
        workspace_archived=workspace.archived_at is not None,
        exposure=exposure,
    )
    payload = dict(body.payload)
    payload["workspaceId"] = exposure.anyharness_workspace_id
    return exposure.anyharness_workspace_id, payload, str(workspace.id)


async def _resolve_backfill_exposed_workspace_command(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    target: targets_store.CloudTargetSnapshot,
    body: CreateCloudCommandRequest,
) -> tuple[str | None, dict[str, object], str | None]:
    if body.cloud_workspace_id is None:
        raise CloudApiError(
            "cloud_command_cloud_workspace_required",
            "backfill_exposed_workspace commands require cloudWorkspaceId.",
            status_code=400,
        )
    cloud_workspace_id = await _resolve_cloud_workspace_id_for_target(
        db,
        target=target,
        cloud_workspace_id=body.cloud_workspace_id,
    )
    exposure = await exposures_store.get_active_workspace_exposure(
        db,
        target_id=target.id,
        cloud_workspace_id=UUID(cloud_workspace_id),
    )
    if (
        exposure is None
        or exposure.archived_at is not None
        or exposure.status != "active"
        or not exposure.anyharness_workspace_id
    ):
        raise CloudApiError(
            "cloud_command_exposure_not_active",
            "Workspace is not exposed for Cloud backfill.",
            status_code=409,
        )
    if body.workspace_id and body.workspace_id != exposure.anyharness_workspace_id:
        raise CloudApiError(
            "cloud_command_workspace_target_mismatch",
            "Backfill workspace id does not match the active exposure.",
            status_code=409,
        )
    await require_workspace_interact(
        db,
        actor_user_id=user.id,
        owner_scope=exposure.owner_scope,
        owner_user_id=exposure.owner_user_id,
        organization_id=exposure.organization_id,
        workspace_archived=False,
        exposure=exposure,
    )
    payload = dict(body.payload)
    payload["workspaceId"] = exposure.anyharness_workspace_id
    return exposure.anyharness_workspace_id, payload, cloud_workspace_id


async def _resolve_prune_workspace_worktree_command(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    target: targets_store.CloudTargetSnapshot,
    body: CreateCloudCommandRequest,
) -> tuple[str | None, dict[str, object], str | None]:
    if body.cloud_workspace_id is None:
        raise CloudApiError(
            "cloud_command_cloud_workspace_required",
            "prune_workspace_worktree commands require cloudWorkspaceId.",
            status_code=400,
        )
    if not body.workspace_id:
        raise CloudApiError(
            "cloud_command_workspace_required",
            "prune_workspace_worktree commands require workspaceId.",
            status_code=400,
        )
    workspace = await cloud_workspaces.get_cloud_workspace_by_id(db, body.cloud_workspace_id)
    if workspace is None:
        raise CloudApiError(
            "cloud_command_workspace_not_found",
            "Workspace not found.",
            status_code=404,
        )
    if (
        workspace.target_id != target.id
        or workspace.sandbox_profile_id != target.sandbox_profile_id
        or workspace.owner_scope != target.owner_scope
        or workspace.owner_user_id != target.owner_user_id
        or workspace.organization_id != target.organization_id
    ):
        raise CloudApiError(
            "cloud_command_workspace_target_mismatch",
            "Workspace is not attached to the requested target.",
            status_code=409,
        )
    if workspace.anyharness_workspace_id != body.workspace_id:
        raise CloudApiError(
            "cloud_command_workspace_target_mismatch",
            "Prune workspace id does not match the Cloud workspace materialization.",
            status_code=409,
        )
    exposure = await exposures_store.get_active_workspace_exposure(
        db,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
    )
    if (
        exposure is not None
        and exposure.anyharness_workspace_id is not None
        and exposure.anyharness_workspace_id != body.workspace_id
    ):
        raise CloudApiError(
            "cloud_command_workspace_target_mismatch",
            "Prune workspace id does not match the active exposure.",
            status_code=409,
        )
    await require_workspace_interact(
        db,
        actor_user_id=user.id,
        owner_scope=workspace.owner_scope,
        owner_user_id=workspace.owner_user_id,
        organization_id=workspace.organization_id,
        workspace_archived=workspace.archived_at is not None,
        exposure=exposure,
    )
    payload = dict(body.payload)
    payload["workspaceId"] = body.workspace_id
    payload["cloudWorkspaceId"] = str(workspace.id)
    return body.workspace_id, payload, str(workspace.id)


async def _resolve_cloud_workspace_id_for_target(
    db: AsyncSession,
    *,
    target: targets_store.CloudTargetSnapshot,
    cloud_workspace_id: UUID,
) -> str:
    workspace = await cloud_workspaces.get_cloud_workspace_by_id(
        db,
        cloud_workspace_id,
    )
    if workspace is None or workspace.archived_at is not None:
        raise CloudApiError(
            "cloud_command_workspace_not_found",
            "Workspace not found.",
            status_code=404,
        )
    requires_managed_workspace = target_requires_cloud_workspace(target)
    if (
        workspace.target_id != target.id
        or (
            requires_managed_workspace
            and workspace.sandbox_profile_id != target.sandbox_profile_id
        )
        or workspace.owner_scope != target.owner_scope
        or workspace.owner_user_id != target.owner_user_id
        or workspace.organization_id != target.organization_id
    ):
        raise CloudApiError(
            "cloud_command_workspace_target_mismatch",
            "Workspace is not attached to the requested target.",
            status_code=409,
        )
    return str(workspace.id)


def direct_start_session_workspace_id(payload: dict[str, object]) -> str | None:
    value = payload.get("workspaceId")
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


def _materialize_payload_requires_cloud_workspace(payload: dict[str, object]) -> bool:
    return payload.get("mode") != "existing_path"


def _materialize_payload_allows_cloud_workspace_scope(payload: dict[str, object]) -> bool:
    return payload.get("mode") != "existing_path"


def command_has_managed_cloud_workspace(
    *,
    target: targets_store.CloudTargetSnapshot,
    kind: str,
    body: CreateCloudCommandRequest,
) -> bool:
    if not target_requires_cloud_workspace(target):
        return False
    if kind == CloudCommandKind.start_session.value:
        return body.cloud_workspace_id is not None or body.workspace_id is not None
    if kind in {
        CloudCommandKind.backfill_exposed_workspace.value,
        CloudCommandKind.prune_workspace_worktree.value,
    }:
        return body.cloud_workspace_id is not None
    if kind in PROJECTED_SESSION_COMMAND_KINDS:
        return body.cloud_workspace_id is not None
    return False
