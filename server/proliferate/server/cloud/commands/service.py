"""Application service for Cloud command creation and status reads."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudCommandActorKind,
    CloudCommandStatus,
    CloudTargetStatus,
)
from proliferate.db.models.auth import User
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.commands.domain.rules import (
    compact_command_json,
    validate_command_shape,
    validate_command_source,
    validate_phase3_command_kind,
)
from proliferate.server.cloud.commands.models import CreateCloudCommandRequest
from proliferate.server.cloud.errors import CloudApiError


def _idempotency_scope_for_target(target: targets_store.CloudTargetSnapshot) -> str:
    if target.organization_id is not None:
        return f"organization:{target.organization_id}"
    return f"user:{target.owner_user_id}"


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
    kind = validate_phase3_command_kind(body.kind)
    source = validate_command_source(body.source)
    validate_command_shape(kind=kind, session_id=body.session_id)
    idempotency_scope = _idempotency_scope_for_target(target)
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
        }
    )
    return await commands_store.create_command(
        db,
        idempotency_scope=idempotency_scope,
        idempotency_key=body.idempotency_key,
        target_id=target.id,
        organization_id=target.organization_id,
        actor_user_id=user.id,
        actor_kind=CloudCommandActorKind.user.value,
        source=source,
        workspace_id=body.workspace_id,
        session_id=body.session_id,
        kind=kind,
        payload_json=compact_command_json(body.payload) or "{}",
        observed_event_seq=body.observed_event_seq,
        preconditions_json=compact_command_json(body.preconditions),
        authorization_context_json=authorization_context_json,
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
