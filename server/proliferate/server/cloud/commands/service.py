"""Application service for Cloud command creation and status reads."""

from __future__ import annotations

import json
from datetime import timedelta
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudCommandActorKind,
    CloudCommandKind,
    CloudCommandSource,
    CloudCommandStatus,
    CloudTargetStatus,
    CloudWorkspaceStatus,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.auth import User
from proliferate.db.store import cloud_runtime_environments, cloud_sandboxes, cloud_workspaces
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_profile_target_guard import managed_profile_target_requires_slot
from proliferate.db.store.cloud_runtime_config import revisions as runtime_config_store
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import events as events_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import target_config as target_config_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud._logging import log_cloud_event
from proliferate.server.cloud.claims.access import require_workspace_interact
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
from proliferate.server.cloud.runtime.domain.wake import command_kind_requires_wake
from proliferate.server.cloud.runtime.wake import kick_off_managed_slot_wake
from proliferate.server.cloud.workspaces.access import cloud_workspace_user_can_read_with_db
from proliferate.utils.time import utcnow

_WEB_COMMAND_QUEUE_EXPIRATION = timedelta(minutes=4)
_WEB_EXPIRABLE_QUEUED_COMMAND_KINDS = {
    CloudCommandKind.start_session.value,
    CloudCommandKind.send_prompt.value,
    CloudCommandKind.update_session_config.value,
}
_WEB_COMMAND_QUEUE_TIMEOUT_CODE = "web_command_queue_timeout"
_WEB_COMMAND_QUEUE_TIMEOUT_MESSAGE = (
    "Cloud runtime did not pick up this Web command before it timed out. "
    "Retry after the workspace shows Live."
)


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


def _str_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


_PROJECTED_SESSION_COMMAND_KINDS = {
    CloudCommandKind.send_prompt.value,
    CloudCommandKind.resolve_interaction.value,
    CloudCommandKind.update_session_config.value,
    CloudCommandKind.cancel_turn.value,
    CloudCommandKind.close_session.value,
}


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
        return None, body.payload, cloud_workspace_id
    if kind in _PROJECTED_SESSION_COMMAND_KINDS:
        return await _resolve_projected_session_command_workspace(
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
    if kind == CloudCommandKind.start_session.value and _target_requires_cloud_workspace(target):
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
        workspace_id = _direct_start_session_workspace_id(body.payload)
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
    user: User,
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
    user: User,
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
            "cloud_command_workspace_slot_missing",
            "Workspace is missing its managed sandbox profile target.",
            status_code=409,
        )
    active_slot = await cloud_sandboxes.load_active_slot_for_profile_target(
        db,
        sandbox_profile_id=workspace.sandbox_profile_id,
        target_id=workspace.target_id,
    )
    if (
        active_slot is None
        or active_slot.slot_generation is None
        or workspace.materialized_slot_generation != active_slot.slot_generation
    ):
        raise CloudApiError(
            "cloud_command_workspace_slot_stale",
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
    user: User,
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


async def _resolve_projected_session_command_workspace(
    db: AsyncSession,
    *,
    user: User,
    target: targets_store.CloudTargetSnapshot,
    body: CreateCloudCommandRequest,
) -> tuple[str | None, dict[str, object], str | None]:
    if not body.session_id:
        raise CloudApiError(
            "cloud_command_session_required",
            "Projected session commands require sessionId.",
            status_code=400,
        )
    projection = await events_store.get_session_projection(
        db,
        target_id=target.id,
        session_id=body.session_id,
    )
    if projection is None or projection.cloud_workspace_id is None:
        raise CloudApiError(
            "cloud_command_session_not_projected",
            "Session is not projected into Cloud.",
            status_code=409,
        )
    if (
        body.cloud_workspace_id is not None
        and body.cloud_workspace_id != projection.cloud_workspace_id
    ):
        raise CloudApiError(
            "cloud_command_workspace_target_mismatch",
            "Session is not attached to the requested Cloud workspace.",
            status_code=409,
        )
    exposure = None
    if projection.exposure_id is not None:
        exposure = await exposures_store.get_workspace_exposure_by_id(
            db,
            projection.exposure_id,
        )
    if exposure is None and projection.cloud_workspace_id is not None:
        exposure = await exposures_store.get_active_workspace_exposure(
            db,
            target_id=target.id,
            cloud_workspace_id=projection.cloud_workspace_id,
        )
    if exposure is None or exposure.archived_at is not None or exposure.status != "active":
        raise CloudApiError(
            "cloud_command_exposure_not_active",
            "Session is not exposed for Cloud commands.",
            status_code=409,
        )
    if not exposure.commandable or not projection.commandable:
        raise CloudApiError(
            "cloud_command_exposure_not_commandable",
            "Session exposure is read-only.",
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
    return (
        projection.workspace_id or body.workspace_id,
        body.payload,
        str(projection.cloud_workspace_id),
    )


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
    return str(workspace.id)


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
        next_payload = dict(payload)
        next_payload.pop("agentAuthScope", None)
        return next_payload
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
    next_payload["sandboxProfileId"] = str(target.sandbox_profile_id)
    next_payload["requiredAgentAuthRevision"] = required_revision
    if kind == CloudCommandKind.start_session.value:
        next_payload["agentAuthScope"] = {
            "provider": "proliferate-cloud",
            "id": str(target.sandbox_profile_id),
            "targetId": str(target.id),
        }
    else:
        next_payload.pop("agentAuthScope", None)
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


def _command_has_managed_cloud_workspace(
    *,
    target: targets_store.CloudTargetSnapshot,
    kind: str,
    body: CreateCloudCommandRequest,
) -> bool:
    if not _target_requires_cloud_workspace(target):
        return False
    if kind == CloudCommandKind.start_session.value:
        return body.cloud_workspace_id is not None or body.workspace_id is not None
    if kind in _PROJECTED_SESSION_COMMAND_KINDS:
        return body.cloud_workspace_id is not None
    return False


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
        workspace_id=(
            body.workspace_id
            or (
                str(body.cloud_workspace_id)
                if kind
                in {
                    CloudCommandKind.start_session.value,
                    CloudCommandKind.backfill_exposed_workspace.value,
                }
                and body.cloud_workspace_id is not None
                else None
            )
            or _direct_start_session_workspace_id(body.payload)
        ),
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
        actor_user_id=user.id,
        target=target,
        payload=payload,
    )
    payload = await _stamp_managed_runtime_config_preflight(
        db,
        actor_user_id=user.id,
        target=target,
        kind=kind,
        payload=payload,
        require_target_config=not _command_has_managed_cloud_workspace(
            target=target,
            kind=kind,
            body=body,
        ),
    )
    validate_command_payload(kind=kind, payload=payload)
    await _validate_runtime_config_preflight(
        db,
        actor_user_id=user.id,
        target=target,
        payload=payload,
    )
    await _validate_managed_runtime_config_current_for_command(
        db,
        actor_user_id=user.id,
        target=target,
        kind=kind,
        require_target_config=not _command_has_managed_cloud_workspace(
            target=target,
            kind=kind,
            body=body,
        ),
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
        log_cloud_event(
            "cloud command enqueue reused existing",
            command_id=existing.id,
            target_id=target.id,
            kind=kind,
            source=source,
            workspace_id=resolved_workspace_id,
            session_id=body.session_id,
            cloud_workspace_id=cloud_workspace_id,
            status=existing.status,
        )
        await _record_pending_prompt_interaction_for_command(db, existing)
        await publish_command_status_after_commit(db, existing)
        await kick_off_command_wake_after_commit_if_required(
            db,
            target=target,
            command=existing,
        )
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
            await _record_pending_prompt_interaction_for_command(db, command)
        log_cloud_event(
            "cloud command queued",
            command_id=command.id,
            target_id=target.id,
            kind=kind,
            source=source,
            workspace_id=resolved_workspace_id,
            session_id=body.session_id,
            cloud_workspace_id=cloud_workspace_id,
            status=command.status,
        )
        await publish_command_status_after_commit(db, command)
        await kick_off_command_wake_after_commit_if_required(
            db,
            target=target,
            command=command,
        )
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


async def enqueue_command_and_commit(
    db: AsyncSession,
    *,
    user: User,
    body: CreateCloudCommandRequest,
) -> commands_store.CloudCommandSnapshot:
    command = await enqueue_command(db, user=user, body=body)
    await db_engine.commit_session(db)
    return command


async def _record_pending_prompt_interaction_for_command(
    db: AsyncSession,
    command: commands_store.CloudCommandSnapshot,
) -> None:
    if (
        command.kind != CloudCommandKind.send_prompt.value
        or command.session_id is None
        or command.cloud_workspace_id is None
    ):
        return
    try:
        payload = json.loads(command.payload_json or "{}")
    except ValueError:
        return
    if not isinstance(payload, dict):
        return
    prompt_id = _str_or_none(payload.get("promptId"))
    text = _str_or_none(payload.get("text"))
    if not prompt_id or not text or not text.strip():
        return
    await events_store.upsert_pending_interaction(
        db,
        target_id=command.target_id,
        cloud_workspace_id=command.cloud_workspace_id,
        workspace_id=command.workspace_id,
        session_id=command.session_id,
        request_id=prompt_id,
        seq=command.observed_event_seq or 0,
        occurred_at=command.created_at.isoformat(),
        kind="send_prompt",
        title="Queued prompt",
        description="Waiting for response.",
        payload_json=compact_command_json(
            {
                "text": text,
                "promptId": prompt_id,
                "commandId": str(command.id),
                "source": command.source,
            }
        ),
    )


async def _validate_agent_auth_preflight(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
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
        if profile.owner_user_id != actor_user_id:
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
    requires_slot = _target_requires_cloud_workspace(target)
    active_slot = None
    if requires_slot:
        active_slot = await cloud_sandboxes.load_active_slot_for_profile_target(
            db,
            sandbox_profile_id=profile.id,
            target_id=target.id,
        )
    if (
        state is None
        or state.status != "applied"
        or state.applied_revision is None
        or state.applied_revision < required_revision
        or (
            active_slot is not None
            and (
                state.active_sandbox_id != active_slot.id
                or state.slot_generation != active_slot.slot_generation
            )
        )
        or (requires_slot and active_slot is None)
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


async def _validate_runtime_config_preflight(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    target: targets_store.CloudTargetSnapshot,
    payload: dict[str, object],
) -> None:
    sandbox_profile_id = payload.get("sandboxProfileId")
    required_revision_id = payload.get("requiredRuntimeConfigRevisionId")
    required_sequence = payload.get("requiredRuntimeConfigSequence")
    required_content_hash = payload.get("requiredRuntimeConfigContentHash")
    if (
        sandbox_profile_id is None
        and required_revision_id is None
        and required_sequence is None
        and required_content_hash is None
    ):
        return
    try:
        profile_id = UUID(str(sandbox_profile_id))
    except (TypeError, ValueError) as exc:
        raise CloudApiError(
            "cloud_command_runtime_config_profile_invalid",
            "Runtime config preflight sandboxProfileId is invalid.",
            status_code=400,
        ) from exc
    if target.sandbox_profile_id != profile_id:
        raise CloudApiError(
            "cloud_command_runtime_config_target_mismatch",
            "Runtime config sandbox profile is not attached to this target.",
            status_code=409,
        )
    if target.owner_scope == "personal" and target.owner_user_id != actor_user_id:
        raise CloudApiError(
            "cloud_command_runtime_config_profile_not_found",
            "Runtime config sandbox profile not found.",
            status_code=404,
        )
    if not isinstance(required_revision_id, str) or not required_revision_id.strip():
        raise CloudApiError(
            "cloud_command_runtime_config_revision_required",
            "Runtime config preflight revision id is required.",
            status_code=400,
        )
    if not isinstance(required_sequence, int) or isinstance(required_sequence, bool):
        raise CloudApiError(
            "cloud_command_runtime_config_sequence_required",
            "Runtime config preflight sequence is required.",
            status_code=400,
        )
    if not isinstance(required_content_hash, str) or not required_content_hash.strip():
        raise CloudApiError(
            "cloud_command_runtime_config_hash_required",
            "Runtime config preflight content hash is required.",
            status_code=400,
        )
    _current, current_revision = await runtime_config_store.get_current(
        db,
        sandbox_profile_id=profile_id,
    )
    if current_revision is None:
        raise CloudApiError(
            "cloud_command_runtime_config_missing",
            "Runtime config has not been compiled for this sandbox profile.",
            status_code=409,
        )
    if (
        str(current_revision.id) != required_revision_id
        or current_revision.sequence != required_sequence
        or current_revision.content_hash != required_content_hash
    ):
        raise CloudApiError(
            "cloud_command_runtime_config_revision_stale",
            "Runtime config preflight revision is stale.",
            status_code=409,
        )
    _raise_runtime_config_blocked_if_needed(current_revision)
    state = await agent_auth_store.get_target_state(
        db,
        sandbox_profile_id=profile_id,
        target_id=target.id,
    )
    active_slot = None
    if _target_requires_cloud_workspace(target):
        active_slot = await cloud_sandboxes.load_active_slot_for_profile_target(
            db,
            sandbox_profile_id=profile_id,
            target_id=target.id,
        )
    if (
        state is None
        or state.runtime_config_status != "applied"
        or state.applied_runtime_config_revision_id != required_revision_id
        or state.applied_runtime_config_sequence < required_sequence
        or (
            active_slot is not None
            and (
                state.active_sandbox_id != active_slot.id
                or state.slot_generation != active_slot.slot_generation
            )
        )
        or (active_slot is None and _target_requires_cloud_workspace(target))
    ):
        raise CloudApiError(
            "cloud_command_runtime_config_not_ready",
            "Runtime config has not been applied to this target.",
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
    if command.cloud_workspace_id is not None:
        await cloud_workspace_user_can_read_with_db(
            db,
            user_id,
            command.cloud_workspace_id,
        )
    command = await _expire_stale_web_command_if_needed(db, command)
    return command


async def _expire_stale_web_command_if_needed(
    db: AsyncSession,
    command: commands_store.CloudCommandSnapshot,
) -> commands_store.CloudCommandSnapshot:
    if command.status != CloudCommandStatus.queued.value:
        return command
    if command.source != CloudCommandSource.web.value:
        return command
    if command.kind not in _WEB_EXPIRABLE_QUEUED_COMMAND_KINDS:
        return command
    now = utcnow()
    if now - command.created_at < _WEB_COMMAND_QUEUE_EXPIRATION:
        return command
    expired = await commands_store.expire_command_if_not_terminal(
        db,
        command_id=command.id,
        error_code=_WEB_COMMAND_QUEUE_TIMEOUT_CODE,
        error_message=_WEB_COMMAND_QUEUE_TIMEOUT_MESSAGE,
        now=now,
        eligible_statuses=(CloudCommandStatus.queued.value,),
    )
    if expired is None:
        return command
    if expired.status == CloudCommandStatus.expired.value:
        await _mark_pending_prompt_interaction_failed_for_command(db, expired)
        await publish_command_status_after_commit(db, expired)
    return expired


async def expire_stale_web_commands_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> tuple[commands_store.CloudCommandSnapshot, ...]:
    now = utcnow()
    expired_commands = await commands_store.expire_stale_queued_commands(
        db,
        target_id=target_id,
        source=CloudCommandSource.web.value,
        command_kinds=tuple(_WEB_EXPIRABLE_QUEUED_COMMAND_KINDS),
        older_than=now - _WEB_COMMAND_QUEUE_EXPIRATION,
        error_code=_WEB_COMMAND_QUEUE_TIMEOUT_CODE,
        error_message=_WEB_COMMAND_QUEUE_TIMEOUT_MESSAGE,
        now=now,
    )
    for command in expired_commands:
        await _mark_pending_prompt_interaction_failed_for_command(db, command)
        await publish_command_status_after_commit(db, command)
    return expired_commands


async def _mark_pending_prompt_interaction_failed_for_command(
    db: AsyncSession,
    command: commands_store.CloudCommandSnapshot,
) -> None:
    if command.kind != CloudCommandKind.send_prompt.value or command.session_id is None:
        return
    try:
        payload = json.loads(command.payload_json or "{}")
    except ValueError:
        return
    if not isinstance(payload, dict):
        return
    prompt_id = _str_or_none(payload.get("promptId"))
    if not prompt_id:
        return
    await events_store.fail_existing_pending_interaction(
        db,
        target_id=command.target_id,
        session_id=command.session_id,
        request_id=prompt_id,
        occurred_at=utcnow().isoformat(),
        description=command.error_message or "Prompt could not be delivered.",
        payload_json=compact_command_json(
            {
                **payload,
                "commandId": str(command.id),
                "errorCode": command.error_code,
                "errorMessage": command.error_message,
                "status": command.status,
            }
        ),
    )


async def _validate_managed_runtime_config_current_for_command(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    target: targets_store.CloudTargetSnapshot,
    kind: str,
    require_target_config: bool = True,
) -> None:
    if kind not in {
        CloudCommandKind.resolve_interaction.value,
        CloudCommandKind.update_session_config.value,
        CloudCommandKind.cancel_turn.value,
        CloudCommandKind.close_session.value,
    }:
        return
    if target.sandbox_profile_id is None:
        return
    if target.owner_scope == "personal" and target.owner_user_id != actor_user_id:
        raise CloudApiError(
            "cloud_command_runtime_config_profile_not_found",
            "Runtime config sandbox profile not found.",
            status_code=404,
        )
    if require_target_config:
        configs = await target_config_store.list_target_configs(db, target_id=target.id)
        if not configs:
            raise CloudApiError(
                "cloud_command_target_config_required",
                "Managed targets require a materialized target config before sessions can start.",
                status_code=409,
            )
    _current, current_revision = await runtime_config_store.get_current(
        db,
        sandbox_profile_id=target.sandbox_profile_id,
    )
    if current_revision is None:
        raise CloudApiError(
            "cloud_command_runtime_config_missing",
            "Runtime config has not been compiled for this sandbox profile.",
            status_code=409,
        )
    _raise_runtime_config_blocked_if_needed(current_revision)
    state = await agent_auth_store.get_target_state(
        db,
        sandbox_profile_id=target.sandbox_profile_id,
        target_id=target.id,
    )
    active_slot = None
    if _target_requires_cloud_workspace(target):
        active_slot = await cloud_sandboxes.load_active_slot_for_profile_target(
            db,
            sandbox_profile_id=target.sandbox_profile_id,
            target_id=target.id,
        )
    if (
        state is None
        or state.runtime_config_status != "applied"
        or state.applied_runtime_config_revision_id != str(current_revision.id)
        or state.applied_runtime_config_sequence < current_revision.sequence
        or (
            active_slot is not None
            and (
                state.active_sandbox_id != active_slot.id
                or state.slot_generation != active_slot.slot_generation
            )
        )
        or (active_slot is None and _target_requires_cloud_workspace(target))
    ):
        raise CloudApiError(
            "cloud_command_runtime_config_not_ready",
            "Runtime config has not been applied to this target.",
            status_code=409,
        )


async def _stamp_managed_runtime_config_preflight(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    target: targets_store.CloudTargetSnapshot,
    kind: str,
    payload: dict[str, object],
    require_target_config: bool = True,
) -> dict[str, object]:
    del actor_user_id
    if kind not in {CloudCommandKind.start_session.value, CloudCommandKind.send_prompt.value}:
        return payload
    if target.sandbox_profile_id is None:
        return payload
    if _runtime_config_preflight_fields_present(payload):
        return payload
    if require_target_config:
        configs = await target_config_store.list_target_configs(db, target_id=target.id)
        if not configs:
            raise CloudApiError(
                "cloud_command_target_config_required",
                "Managed targets require a materialized target config before sessions can start.",
                status_code=409,
            )
    _current, current_revision = await runtime_config_store.get_current(
        db,
        sandbox_profile_id=target.sandbox_profile_id,
    )
    if current_revision is None:
        raise CloudApiError(
            "cloud_command_runtime_config_missing",
            "Runtime config has not been compiled for this sandbox profile.",
            status_code=409,
        )
    _raise_runtime_config_blocked_if_needed(current_revision)
    state = await agent_auth_store.get_target_state(
        db,
        sandbox_profile_id=target.sandbox_profile_id,
        target_id=target.id,
    )
    active_slot = await cloud_sandboxes.load_active_slot_for_profile_target(
        db,
        sandbox_profile_id=target.sandbox_profile_id,
        target_id=target.id,
    )
    if (
        state is None
        or state.runtime_config_status != "applied"
        or state.applied_runtime_config_revision_id != str(current_revision.id)
        or state.applied_runtime_config_sequence < current_revision.sequence
        or active_slot is None
        or state.active_sandbox_id != active_slot.id
        or state.slot_generation != active_slot.slot_generation
    ):
        raise CloudApiError(
            "cloud_command_runtime_config_not_ready",
            "Runtime config has not been applied to this target.",
            status_code=409,
        )
    stamped = dict(payload)
    stamped["sandboxProfileId"] = str(target.sandbox_profile_id)
    stamped["requiredRuntimeConfigRevisionId"] = str(current_revision.id)
    stamped["requiredRuntimeConfigSequence"] = current_revision.sequence
    stamped["requiredRuntimeConfigContentHash"] = current_revision.content_hash
    if kind == CloudCommandKind.start_session.value:
        stamped["expectedRuntimeConfigRevision"] = {
            "revisionId": str(current_revision.id),
            "sequence": current_revision.sequence,
            "contentHash": current_revision.content_hash,
            "externalScope": {
                "provider": "proliferate-cloud",
                "id": str(target.sandbox_profile_id),
                "targetId": str(target.id),
            },
        }
    return stamped


def _runtime_config_preflight_fields_present(payload: dict[str, object]) -> bool:
    return any(
        key in payload
        for key in (
            "requiredRuntimeConfigRevisionId",
            "requiredRuntimeConfigSequence",
            "requiredRuntimeConfigContentHash",
        )
    )


async def stamp_and_validate_runtime_config_preflight(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    target_id: UUID,
    kind: str,
    payload: dict[str, object],
) -> dict[str, object]:
    target = await targets_store.get_target_by_id(db, target_id)
    if target is None:
        raise CloudApiError(
            "cloud_command_target_not_found",
            "Target not found.",
            status_code=404,
        )
    stamped = await _stamp_managed_runtime_config_preflight(
        db,
        actor_user_id=actor_user_id,
        target=target,
        kind=kind,
        payload=payload,
    )
    await _validate_runtime_config_preflight(
        db,
        actor_user_id=actor_user_id,
        target=target,
        payload=stamped,
    )
    return stamped


async def stamp_and_validate_command_preflight(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    target_id: UUID,
    kind: str,
    payload: dict[str, object],
) -> dict[str, object]:
    target = await targets_store.get_target_by_id(db, target_id)
    if target is None:
        raise CloudApiError(
            "cloud_command_target_not_found",
            "Target not found.",
            status_code=404,
        )
    payload = await _populate_agent_auth_preflight_payload(
        db,
        target=target,
        kind=kind,
        payload=payload,
    )
    validate_command_payload(kind=kind, payload=payload)
    await _validate_agent_auth_preflight(
        db,
        actor_user_id=actor_user_id,
        target=target,
        payload=payload,
    )
    payload = await _stamp_managed_runtime_config_preflight(
        db,
        actor_user_id=actor_user_id,
        target=target,
        kind=kind,
        payload=payload,
    )
    validate_command_payload(kind=kind, payload=payload)
    await _validate_runtime_config_preflight(
        db,
        actor_user_id=actor_user_id,
        target=target,
        payload=payload,
    )
    await _validate_managed_runtime_config_current_for_command(
        db,
        actor_user_id=actor_user_id,
        target=target,
        kind=kind,
    )
    return payload


def _raise_runtime_config_blocked_if_needed(
    revision: runtime_config_store.SandboxProfileRuntimeConfigRevisionSnapshot,
) -> None:
    blocking_errors = _runtime_config_blocking_errors(revision.manifest_json)
    if not blocking_errors:
        return
    raise CloudApiError(
        "cloud_command_runtime_config_blocked",
        "Runtime config has blocking resolver errors and cannot launch.",
        status_code=409,
    )


def _runtime_config_blocking_errors(manifest_json: str) -> list[dict[str, object]]:
    try:
        manifest = json.loads(manifest_json)
    except ValueError:
        return []
    if not isinstance(manifest, dict):
        return []
    blocking_errors = manifest.get("blockingErrors")
    if not isinstance(blocking_errors, list):
        return []
    return [item for item in blocking_errors if isinstance(item, dict)]


def _command_requires_managed_slot_wake(
    target: targets_store.CloudTargetSnapshot,
    command: commands_store.CloudCommandSnapshot,
) -> bool:
    if is_terminal_command_status(command.status):
        return False
    if not _target_requires_cloud_workspace(target):
        return False
    return command_kind_requires_wake(command.kind)


async def kick_off_command_wake_after_commit_if_required(
    db: AsyncSession,
    *,
    target: targets_store.CloudTargetSnapshot,
    command: commands_store.CloudCommandSnapshot,
) -> None:
    if not _command_requires_managed_slot_wake(target, command):
        return

    async def _wake_after_commit() -> None:
        kick_off_managed_slot_wake(target.id, command.id)

    await db_engine.run_after_commit(db, _wake_after_commit)


def is_terminal_command_status(status: str) -> bool:
    return status in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.expired.value,
        CloudCommandStatus.superseded.value,
        CloudCommandStatus.failed_delivery.value,
    }
