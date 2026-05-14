"""Application service for Cloud command creation and status reads."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudCommandActorKind,
    CloudCommandKind,
    CloudCommandStatus,
    CloudTargetStatus,
    CloudWorkspaceStatus,
)
from proliferate.db.models.auth import User
from proliferate.db.store import cloud_runtime_environments, cloud_workspaces
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.commands.domain.rules import (
    compact_command_json,
    validate_active_command_kind,
    validate_command_shape,
    validate_command_source,
)
from proliferate.server.cloud.commands.models import CreateCloudCommandRequest
from proliferate.server.cloud.errors import CloudApiError


def _idempotency_scope_for_command(
    *,
    target: targets_store.CloudTargetSnapshot,
    kind: str,
    workspace_id: str | None,
    session_id: str | None,
) -> str:
    workspace_scope = workspace_id or "-"
    session_scope = session_id or "-"
    if target.organization_id is not None:
        return (
            f"organization:{target.organization_id}:target:{target.id}:"
            f"workspace:{workspace_scope}:session:{session_scope}:kind:{kind}"
        )
    return (
        f"user:{target.owner_user_id}:target:{target.id}:"
        f"workspace:{workspace_scope}:session:{session_scope}:kind:{kind}"
    )


async def _resolve_command_workspace(
    db: AsyncSession,
    *,
    user: User,
    target: targets_store.CloudTargetSnapshot,
    kind: str,
    body: CreateCloudCommandRequest,
) -> tuple[str | None, dict[str, object], str | None]:
    if kind != CloudCommandKind.start_session.value:
        return body.workspace_id, body.payload, None
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
    runtime_environment = await cloud_runtime_environments.get_runtime_environment_for_workspace(
        db,
        workspace,
    )
    if runtime_environment is None or runtime_environment.target_id != target.id:
        raise CloudApiError(
            "cloud_command_workspace_target_mismatch",
            "Workspace is not attached to the requested target.",
            status_code=409,
        )
    payload = dict(body.payload)
    payload["workspaceId"] = workspace.anyharness_workspace_id
    return workspace.anyharness_workspace_id, payload, str(workspace.id)


async def enqueue_command(
    db: AsyncSession,
    *,
    user: User,
    body: CreateCloudCommandRequest,
) -> commands_store.CloudCommandSnapshot:
    target = await targets_store.get_visible_target_by_id(
        db,
        target_id=body.target_id,
        user_id=user.id,
    )
    if target is None:
        raise CloudApiError(
            "cloud_command_target_not_found",
            "Target not found.",
            status_code=404,
        )
    if target.status == CloudTargetStatus.archived.value:
        raise CloudApiError(
            "cloud_command_target_archived",
            "Target is archived.",
            status_code=409,
        )
    kind = validate_active_command_kind(body.kind)
    source = validate_command_source(body.source)
    validate_command_shape(
        kind=kind,
        workspace_id=body.workspace_id,
        session_id=body.session_id,
        preconditions=body.preconditions,
    )
    resolved_workspace_id, payload, cloud_workspace_id = await _resolve_command_workspace(
        db,
        user=user,
        target=target,
        kind=kind,
        body=body,
    )
    idempotency_scope = _idempotency_scope_for_command(
        target=target,
        kind=kind,
        workspace_id=resolved_workspace_id,
        session_id=body.session_id,
    )
    existing = await commands_store.get_command_by_idempotency(
        db,
        idempotency_scope=idempotency_scope,
        idempotency_key=body.idempotency_key,
    )
    if existing is not None:
        return existing
    authorization_context_json = compact_command_json(
        {
            "actorUserId": str(user.id),
            "targetOwnerScope": target.owner_scope,
            "targetOrganizationId": (
                str(target.organization_id) if target.organization_id else None
            ),
            "cloudWorkspaceId": cloud_workspace_id,
        }
    )
    try:
        async with db.begin_nested():
            return await commands_store.create_command(
                db,
                idempotency_scope=idempotency_scope,
                idempotency_key=body.idempotency_key,
                target_id=target.id,
                organization_id=target.organization_id,
                actor_user_id=user.id,
                actor_kind=CloudCommandActorKind.user.value,
                source=source,
                workspace_id=resolved_workspace_id,
                session_id=body.session_id,
                kind=kind,
                payload_json=compact_command_json(payload) or "{}",
                observed_event_seq=body.observed_event_seq,
                preconditions_json=compact_command_json(body.preconditions),
                authorization_context_json=authorization_context_json,
            )
    except IntegrityError:
        duplicate = await commands_store.get_command_by_idempotency(
            db,
            idempotency_scope=idempotency_scope,
            idempotency_key=body.idempotency_key,
        )
        if duplicate is not None:
            return duplicate
        raise


async def get_command_status(
    db: AsyncSession,
    *,
    command_id: UUID,
    user_id: UUID,
) -> commands_store.CloudCommandSnapshot:
    command = await commands_store.get_command_by_id(db, command_id)
    if command is None:
        raise CloudApiError(
            "cloud_command_not_found",
            "Command not found.",
            status_code=404,
        )
    target = await targets_store.get_visible_target_by_id(
        db,
        target_id=command.target_id,
        user_id=user_id,
    )
    if target is None:
        raise CloudApiError(
            "cloud_command_not_found",
            "Command not found.",
            status_code=404,
        )
    return command


def is_terminal_command_status(status: str) -> bool:
    return status in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.expired.value,
        CloudCommandStatus.superseded.value,
        CloudCommandStatus.failed_delivery.value,
    }
