"""Application service for target-level Git identity materialization."""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import ReadyGitHubGrant, get_ready_github_grant_for_user
from proliferate.constants.cloud import (
    SUPPORTED_GIT_PROVIDER,
    CloudCommandKind,
    CloudCommandStatus,
)
from proliferate.db.models.auth import User
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import target_git_identity as identity_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.commands.models import (
    CreateCloudCommandRequest,
    command_response_payload,
)
from proliferate.server.cloud.commands.service import enqueue_command
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.target_config.domain.rules import resolve_git_identity
from proliferate.server.cloud.target_git_identity.models import (
    MaterializeTargetGitIdentityResponse,
    TargetGitIdentityMaterializationPlan,
    TargetGitIdentitySummaryModel,
    WorkerTargetGitIdentityStatusRequest,
    WorkerTargetGitIdentityStatusResponse,
    target_git_identity_payload,
)
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.utils.crypto import decrypt_json, encrypt_json


def _command_idempotency_key(
    *,
    requested: str | None,
    identity_id: UUID,
    version: int,
) -> str:
    value = (requested or "").strip()
    if value:
        return f"target-git-identity:{identity_id}:v{version}:{value}"
    return f"target-git-identity:{identity_id}:v{version}"


async def _require_configure_git_command(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID,
    identity_id: UUID,
    command_id: UUID,
    config_version: int,
    lease_id: str,
) -> None:
    command = await commands_store.get_command_by_id(db, command_id)
    if (
        command is None
        or command.target_id != target_id
        or command.leased_by_worker_id != worker_id
        or command.kind != CloudCommandKind.configure_git_identity.value
        or command.status != CloudCommandStatus.leased.value
        or command.lease_id != lease_id
    ):
        raise CloudApiError(
            "target_git_identity_command_not_found",
            "Target Git identity command is not leased by this worker.",
            status_code=404,
        )
    try:
        payload = json.loads(command.payload_json)
    except json.JSONDecodeError as exc:
        raise CloudApiError(
            "target_git_identity_command_invalid",
            "Target Git identity command payload is invalid.",
            status_code=409,
        ) from exc
    if not isinstance(payload, dict) or payload.get("targetGitIdentityId") != str(identity_id):
        raise CloudApiError(
            "target_git_identity_command_mismatch",
            "Target Git identity command does not match the requested identity.",
            status_code=409,
        )
    if payload.get("configVersion") != config_version:
        raise CloudApiError(
            "target_git_identity_command_mismatch",
            "Target Git identity command does not match the requested version.",
            status_code=409,
        )


async def _require_github_grant(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> ReadyGitHubGrant:
    github_grant = await get_ready_github_grant_for_user(db, user_id=user_id)
    if github_grant is None:
        raise CloudApiError(
            "github_link_required",
            "Connect GitHub before registering or using a cloud target.",
            status_code=400,
        )
    return github_grant


async def require_user_github_auth(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> None:
    await _require_github_grant(db, user_id=user_id)


async def materialize_target_git_identity(
    db: AsyncSession,
    *,
    target_id: UUID,
    user: User,
    source: str,
    idempotency_key: str | None = None,
) -> MaterializeTargetGitIdentityResponse:
    target = await targets_store.get_visible_target_by_id(
        db,
        target_id=target_id,
        user_id=user.id,
    )
    if target is None:
        raise CloudApiError(
            "target_git_identity_target_not_found",
            "Target not found.",
            status_code=404,
        )
    github_grant = await _require_github_grant(db, user_id=user.id)
    git_user_name, git_user_email = resolve_git_identity(
        user,
        github_grant,
    )
    summary = TargetGitIdentitySummaryModel(
        provider=SUPPORTED_GIT_PROVIDER,
        username_present=bool(git_user_name),
        email_present=bool(git_user_email),
    )
    pending_plan = TargetGitIdentityMaterializationPlan(
        target_git_identity_id="pending",
        target_id=str(target.id),
        config_version=0,
        provider=SUPPORTED_GIT_PROVIDER,
        access_token=github_grant.access_token,
        username=git_user_name,
        email=git_user_email,
    )
    identity = await identity_store.upsert_target_git_identity(
        db,
        target_id=target.id,
        user_id=user.id,
        organization_id=target.organization_id,
        provider=SUPPORTED_GIT_PROVIDER,
        payload_ciphertext=encrypt_json({"pending": True}),
        summary_json=summary.model_dump_json(),
    )
    finalized_plan = pending_plan.model_copy(
        update={
            "target_git_identity_id": str(identity.id),
            "config_version": identity.config_version,
        }
    )
    updated_identity = await identity_store.update_target_git_identity_payload(
        db,
        identity_id=identity.id,
        payload_ciphertext=encrypt_json(finalized_plan.model_dump(mode="json", by_alias=True)),
        summary_json=summary.model_dump_json(),
    )
    if updated_identity is None:
        raise CloudApiError(
            "target_git_identity_not_found",
            "Target Git identity was not found after materialization plan creation.",
            status_code=500,
        )
    identity = updated_identity
    command = await enqueue_command(
        db,
        user=user,
        body=CreateCloudCommandRequest.model_validate(
            {
                "idempotencyKey": _command_idempotency_key(
                    requested=idempotency_key,
                    identity_id=identity.id,
                    version=identity.config_version,
                ),
                "targetId": str(target.id),
                "kind": CloudCommandKind.configure_git_identity.value,
                "payload": {
                    "targetGitIdentityId": str(identity.id),
                    "configVersion": identity.config_version,
                },
                "source": source,
            }
        ),
    )
    queued = await identity_store.mark_target_git_identity_queued(
        db,
        identity_id=identity.id,
        command_id=command.id,
    )
    if queued is None:
        raise CloudApiError(
            "target_git_identity_not_found",
            "Target Git identity was not found after command creation.",
            status_code=500,
        )
    return MaterializeTargetGitIdentityResponse(
        target_git_identity=target_git_identity_payload(queued),
        command=command_response_payload(command),
    )


async def worker_target_git_identity_plan(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    identity_id: UUID,
    command_id: UUID,
    config_version: int,
    lease_id: str,
) -> TargetGitIdentityMaterializationPlan:
    await _require_configure_git_command(
        db,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        identity_id=identity_id,
        command_id=command_id,
        config_version=config_version,
        lease_id=lease_id,
    )
    identity = await identity_store.get_target_git_identity_for_worker_command(
        db,
        identity_id=identity_id,
        target_id=auth.target_id,
        command_id=command_id,
        config_version=config_version,
    )
    if identity is None:
        raise CloudApiError(
            "target_git_identity_not_found",
            "Target Git identity not found.",
            status_code=404,
        )
    return TargetGitIdentityMaterializationPlan.model_validate(
        decrypt_json(identity.payload_ciphertext)
    )


async def record_worker_target_git_identity_status(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    identity_id: UUID,
    body: WorkerTargetGitIdentityStatusRequest,
) -> WorkerTargetGitIdentityStatusResponse:
    await _require_configure_git_command(
        db,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        identity_id=identity_id,
        command_id=body.command_id,
        config_version=body.config_version,
        lease_id=body.lease_id,
    )
    identity = await identity_store.mark_target_git_identity_status(
        db,
        identity_id=identity_id,
        target_id=auth.target_id,
        command_id=body.command_id,
        config_version=body.config_version,
        status=body.status,
        error_code=body.error_code,
        error_message=body.error_message,
    )
    if identity is None:
        raise CloudApiError(
            "target_git_identity_not_found",
            "Target Git identity not found.",
            status_code=404,
        )
    return WorkerTargetGitIdentityStatusResponse(
        target_git_identity_id=str(identity.id),
        status=identity.materialization_status,
        updated=True,
    )
