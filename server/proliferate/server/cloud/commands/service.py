"""Application service for Cloud command creation and status reads."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.cloud import (
    CloudCommandActorKind,
    CloudCommandKind,
    CloudTargetStatus,
)
from proliferate.db.session_ops import is_integrity_error
from proliferate.db.store.cloud_sync import command_records
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.commands.client_state import (
    expire_stale_client_command_if_needed,
    record_pending_prompt_interaction_for_command,
)
from proliferate.server.cloud.commands.domain.payload import validate_command_payload
from proliferate.server.cloud.commands.domain.rules import (
    validate_active_command_kind,
    validate_command_shape,
    validate_command_source,
)
from proliferate.server.cloud.commands.domain.serialization import compact_command_json
from proliferate.server.cloud.commands.models import CreateCloudCommandRequest
from proliferate.server.cloud.commands.preflight import (
    populate_agent_auth_preflight_payload,
    stamp_managed_runtime_config_preflight,
    validate_agent_auth_preflight,
    validate_managed_runtime_config_current_for_command,
    validate_runtime_config_preflight,
)
from proliferate.server.cloud.commands.wake import kick_off_command_wake_after_commit_if_required
from proliferate.server.cloud.commands.workspace_scope import (
    command_has_managed_cloud_workspace,
    direct_start_session_workspace_id,
    resolve_command_workspace,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.live.service import publish_command_status_after_commit
from proliferate.server.cloud.workspaces.access import cloud_workspace_user_can_read_with_db


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


async def enqueue_command(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    body: CreateCloudCommandRequest,
) -> command_records.CloudCommandSnapshot:
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
            or direct_start_session_workspace_id(body.payload)
        ),
        session_id=body.session_id,
        preconditions=body.preconditions,
    )
    payload = await populate_agent_auth_preflight_payload(
        db,
        target=target,
        kind=kind,
        payload=body.payload,
    )
    validate_command_payload(kind=kind, payload=payload)
    await validate_agent_auth_preflight(
        db,
        actor_user_id=user.id,
        target=target,
        payload=payload,
    )
    payload = await stamp_managed_runtime_config_preflight(
        db,
        actor_user_id=user.id,
        target=target,
        kind=kind,
        payload=payload,
        require_target_config=not command_has_managed_cloud_workspace(
            target=target,
            kind=kind,
            body=body,
        ),
    )
    validate_command_payload(kind=kind, payload=payload)
    await validate_runtime_config_preflight(
        db,
        actor_user_id=user.id,
        target=target,
        payload=payload,
    )
    await validate_managed_runtime_config_current_for_command(
        db,
        actor_user_id=user.id,
        target=target,
        kind=kind,
        require_target_config=not command_has_managed_cloud_workspace(
            target=target,
            kind=kind,
            body=body,
        ),
    )
    command_body = body.model_copy(update={"payload": payload})
    resolved_workspace_id, payload, cloud_workspace_id = await resolve_command_workspace(
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
        await record_pending_prompt_interaction_for_command(db, existing)
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
            await record_pending_prompt_interaction_for_command(db, command)
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
    except Exception as exc:
        if not is_integrity_error(exc):
            raise
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
) -> command_records.CloudCommandSnapshot:
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
    command = await expire_stale_client_command_if_needed(db, command)
    return command
