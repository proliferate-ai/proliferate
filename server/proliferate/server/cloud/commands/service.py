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
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_profile_target_guard import managed_profile_target_requires_slot
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.commands.domain.rules import (
    compact_command_json,
    validate_active_command_kind,
    validate_command_payload,
    validate_command_shape,
    validate_command_source,
)
from proliferate.server.cloud.commands.models import CreateCloudCommandRequest
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.live.service import publish_command_status_after_commit


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
    if kind == CloudCommandKind.materialize_workspace.value and _target_requires_cloud_workspace(
        target
    ):
        if body.cloud_workspace_id is None:
            raise CloudApiError(
                "cloud_command_cloud_workspace_required",
                "Managed materialize_workspace commands require cloudWorkspaceId.",
                status_code=400,
            )
        workspace = await cloud_workspaces.get_cloud_workspace_by_id(
            db,
            body.cloud_workspace_id,
        )
        if workspace is None or workspace.archived_at is not None:
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
        return None, body.payload, str(workspace.id)
    if kind != CloudCommandKind.start_session.value:
        return body.workspace_id, body.payload, None
    if not body.workspace_id:
        workspace_id = _direct_start_session_workspace_id(body.payload)
        if workspace_id is None:
            return None, body.payload, None
        payload = dict(body.payload)
        payload["workspaceId"] = workspace_id
        return workspace_id, payload, None
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
    payload = dict(body.payload)
    payload["workspaceId"] = workspace.anyharness_workspace_id
    return workspace.anyharness_workspace_id, payload, str(workspace.id)


async def _populate_agent_auth_preflight_payload(
    db: AsyncSession,
    *,
    target: targets_store.CloudTargetSnapshot,
    kind: str,
    payload: dict[str, object],
) -> dict[str, object]:
    if kind not in {
        CloudCommandKind.start_session.value,
        CloudCommandKind.send_prompt.value,
    }:
        return payload
    if target.sandbox_profile_id is None:
        return payload
    if "sandboxProfileId" in payload and "requiredAgentAuthRevision" in payload:
        return payload
    state = await agent_auth_store.get_target_state(
        db,
        sandbox_profile_id=target.sandbox_profile_id,
        target_id=target.id,
    )
    if state is None:
        profile = await agent_auth_store.get_sandbox_profile(db, target.sandbox_profile_id)
        if profile is None:
            return payload
        required_revision = profile.agent_auth_revision
    else:
        required_revision = state.desired_revision
    next_payload = dict(payload)
    next_payload.setdefault("sandboxProfileId", str(target.sandbox_profile_id))
    next_payload.setdefault("requiredAgentAuthRevision", required_revision)
    return next_payload


def _direct_start_session_workspace_id(payload: dict[str, object]) -> str | None:
    value = payload.get("workspaceId")
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


def _target_requires_cloud_workspace(target: targets_store.CloudTargetSnapshot) -> bool:
    return managed_profile_target_requires_slot(
        kind=target.kind,
        sandbox_profile_id=target.sandbox_profile_id,
        profile_target_role=target.profile_target_role,
    )


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
    if kind == CloudCommandKind.refresh_agent_auth_config.value:
        raise CloudApiError(
            "cloud_command_internal_only",
            "Agent auth refresh commands are created by sandbox profile changes.",
            status_code=400,
        )
    validate_command_shape(
        kind=kind,
        workspace_id=body.workspace_id or _direct_start_session_workspace_id(body.payload),
        session_id=body.session_id,
        preconditions=body.preconditions,
    )
    payload = await _populate_agent_auth_preflight_payload(
        db,
        target=target,
        kind=kind,
        payload=body.payload,
    )
    validate_command_payload(kind=kind, payload=payload)
    await _validate_agent_auth_preflight(
        db,
        user=user,
        target=target,
        payload=payload,
    )
    command_body = body.model_copy(update={"payload": payload})
    resolved_workspace_id, payload, cloud_workspace_id = await _resolve_command_workspace(
        db,
        user=user,
        target=target,
        kind=kind,
        body=command_body,
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
        await publish_command_status_after_commit(db, existing)
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
            command = await commands_store.create_command(
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
                cloud_workspace_id=UUID(cloud_workspace_id) if cloud_workspace_id else None,
                kind=kind,
                payload_json=compact_command_json(payload) or "{}",
                observed_event_seq=body.observed_event_seq,
                preconditions_json=compact_command_json(body.preconditions),
                authorization_context_json=authorization_context_json,
            )
        await publish_command_status_after_commit(db, command)
        return command
    except IntegrityError:
        duplicate = await commands_store.get_command_by_idempotency(
            db,
            idempotency_scope=idempotency_scope,
            idempotency_key=body.idempotency_key,
        )
        if duplicate is not None:
            return duplicate
        raise


async def _validate_agent_auth_preflight(
    db: AsyncSession,
    *,
    user: User,
    target: targets_store.CloudTargetSnapshot,
    payload: dict[str, object],
) -> None:
    sandbox_profile_id = payload.get("sandboxProfileId")
    required_revision = payload.get("requiredAgentAuthRevision")
    if sandbox_profile_id is None and required_revision is None:
        return
    try:
        profile_id = UUID(str(sandbox_profile_id))
    except (TypeError, ValueError) as exc:
        raise CloudApiError(
            "cloud_command_agent_auth_profile_invalid",
            "Agent auth preflight sandboxProfileId is invalid.",
            status_code=400,
        ) from exc
    if not isinstance(required_revision, int) or isinstance(required_revision, bool):
        raise CloudApiError(
            "cloud_command_agent_auth_revision_required",
            "Agent auth preflight requiredAgentAuthRevision is required.",
            status_code=400,
        )
    profile = await agent_auth_store.get_sandbox_profile(db, profile_id)
    if profile is None:
        raise CloudApiError(
            "cloud_command_agent_auth_profile_not_found",
            "Agent auth sandbox profile not found.",
            status_code=404,
        )
    if profile.primary_target_id != target.id:
        raise CloudApiError(
            "cloud_command_agent_auth_target_mismatch",
            "Agent auth sandbox profile is not attached to this target.",
            status_code=409,
        )
    if profile.owner_scope == "personal":
        if profile.owner_user_id != user.id:
            raise CloudApiError(
                "cloud_command_agent_auth_profile_not_found",
                "Agent auth sandbox profile not found.",
                status_code=404,
            )
    elif profile.organization_id != target.organization_id or profile.organization_id is None:
        raise CloudApiError(
            "cloud_command_agent_auth_target_mismatch",
            "Agent auth sandbox profile does not match this target organization.",
            status_code=409,
        )
    if required_revision != profile.agent_auth_revision:
        raise CloudApiError(
            "cloud_command_agent_auth_revision_stale",
            "Agent auth preflight revision is stale.",
            status_code=409,
        )
    state = await agent_auth_store.get_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=target.id,
    )
    if (
        state is None
        or state.status != "applied"
        or state.applied_revision is None
        or state.applied_revision < required_revision
    ):
        raise CloudApiError(
            "cloud_command_agent_auth_not_ready",
            "Agent auth config has not been applied to this target.",
            status_code=409,
        )
    if state.force_restart_required:
        raise CloudApiError(
            "cloud_command_agent_auth_restart_required",
            "Agent auth changes require the session to restart before this command can run.",
            status_code=409,
        )


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
