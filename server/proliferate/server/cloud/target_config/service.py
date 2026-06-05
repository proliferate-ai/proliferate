"""Application service for cloud target environment materialization."""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.auth.identity.store import get_ready_github_grant_for_user
from proliferate.constants.cloud import (
    SUPPORTED_GIT_PROVIDER,
    CloudCommandKind,
    CloudCommandStatus,
)
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.cloud_repo_config import (
    get_cloud_repo_config,
    get_organization_cloud_repo_config,
)
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import target_config as target_config_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.commands.models import (
    CreateCloudCommandRequest,
    command_response_payload,
)
from proliferate.server.cloud.commands.service import enqueue_command
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime_config.service import (
    refresh_profile_runtime_config,
    runtime_config_fragment_for_profile,
)
from proliferate.server.cloud.target_config.domain.policy import require_target_materializable
from proliferate.server.cloud.target_config.domain.rules import (
    default_workspace_root,
    normalize_git_provider,
    normalize_repo_component,
    normalize_workspace_root,
    require_workspace_root_under_target_root,
    resolve_git_identity,
)
from proliferate.server.cloud.target_config.models import (
    MaterializeTargetConfigRequest,
    MaterializeTargetConfigResponse,
    TargetConfigGitCredentialModel,
    TargetConfigMaterializationPlan,
    TargetConfigRepoModel,
    TargetConfigSummaryModel,
    TargetConfigTrackedFileModel,
    WorkerTargetConfigStatusRequest,
    WorkerTargetConfigStatusResponse,
    target_config_payload,
)
from proliferate.server.cloud.targets.domain.policy import require_target_admin_membership
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.server.cloud.worker.target_validation import (
    require_active_worker_target as _require_active_worker_target,
)
from proliferate.utils.crypto import decrypt_json, encrypt_json


def _command_idempotency_key(
    *,
    requested: str | None,
    target_config_id: UUID,
    version: int,
) -> str:
    value = (requested or "").strip()
    if value:
        return f"target-config:{target_config_id}:v{version}:{value}"
    return f"target-config:{target_config_id}:v{version}"


def _required_tools(
    *,
    include_git: bool,
    mcp_binding_count: int,
    plugin_package_count: int,
) -> list[str]:
    tools: list[str] = []
    if include_git:
        tools.append("git")
    if mcp_binding_count or plugin_package_count:
        tools.append("node")
    return tools


async def _require_materialization_command(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID,
    config_id: UUID,
    command_id: UUID,
    config_version: int,
    lease_id: str,
) -> None:
    command = await commands_store.get_command_by_id(db, command_id)
    if (
        command is None
        or command.target_id != target_id
        or command.leased_by_worker_id != worker_id
        or command.kind != CloudCommandKind.materialize_environment.value
        or command.status != CloudCommandStatus.leased.value
        or command.lease_id != lease_id
    ):
        raise CloudApiError(
            "target_config_command_not_found",
            "Target config command is not leased by this worker.",
            status_code=404,
        )
    try:
        payload = json.loads(command.payload_json)
    except json.JSONDecodeError as exc:
        raise CloudApiError(
            "target_config_command_invalid",
            "Target config command payload is invalid.",
            status_code=409,
        ) from exc
    if not isinstance(payload, dict) or payload.get("targetConfigId") != str(config_id):
        raise CloudApiError(
            "target_config_command_mismatch",
            "Target config command does not match the requested config.",
            status_code=409,
        )
    if payload.get("configVersion") != config_version:
        raise CloudApiError(
            "target_config_command_mismatch",
            "Target config command does not match the requested config version.",
            status_code=409,
        )


async def _visible_target(
    db: AsyncSession,
    *,
    target_id: UUID,
    user_id: UUID,
) -> targets_store.CloudTargetSnapshot:
    target = await targets_store.get_visible_target_by_id(
        db,
        target_id=target_id,
        user_id=user_id,
    )
    if target is None:
        raise CloudApiError(
            "target_config_target_not_found",
            "Target not found.",
            status_code=404,
        )
    require_target_materializable(target)
    return target


async def _controllable_target(
    db: AsyncSession,
    *,
    target_id: UUID,
    user_id: UUID,
) -> targets_store.CloudTargetSnapshot:
    target = await _visible_target(db, target_id=target_id, user_id=user_id)
    if target.organization_id is None:
        return target
    membership = await organizations_store.get_active_membership(
        db,
        organization_id=target.organization_id,
        user_id=user_id,
    )
    require_target_admin_membership(membership)
    return target


async def list_target_configs(
    db: AsyncSession,
    *,
    target_id: UUID,
    user_id: UUID,
) -> tuple[target_config_store.CloudTargetConfigSnapshot, ...]:
    target = await _visible_target(db, target_id=target_id, user_id=user_id)
    return await target_config_store.list_target_configs(db, target_id=target.id)


async def get_target_config(
    db: AsyncSession,
    *,
    target_id: UUID,
    config_id: UUID,
    user_id: UUID,
) -> target_config_store.CloudTargetConfigSnapshot:
    target = await _visible_target(db, target_id=target_id, user_id=user_id)
    config = await target_config_store.get_target_config_by_id(db, config_id)
    if config is None or config.target_id != target.id:
        raise CloudApiError(
            "target_config_not_found",
            "Target config not found.",
            status_code=404,
        )
    return config


async def materialize_target_config(
    db: AsyncSession,
    *,
    target_id: UUID,
    user: ActorIdentity,
    body: MaterializeTargetConfigRequest,
) -> MaterializeTargetConfigResponse:
    target = await _controllable_target(db, target_id=target_id, user_id=user.id)
    git_provider = normalize_git_provider(body.git_provider)
    git_owner = normalize_repo_component(body.git_owner, field_name="gitOwner")
    git_repo_name = normalize_repo_component(body.git_repo_name, field_name="gitRepoName")
    target_workspace_root = (target.default_workspace_root or "").strip() or (
        "~/proliferate-workspaces"
    )
    fallback_workspace_root = default_workspace_root(
        target_default_workspace_root=target.default_workspace_root,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    workspace_root = normalize_workspace_root(
        body.workspace_root,
        fallback=fallback_workspace_root,
    )
    require_workspace_root_under_target_root(
        workspace_root=workspace_root,
        target_root=target_workspace_root,
    )

    if body.owner_scope == "organization":
        if body.organization_id is None:
            raise CloudApiError(
                "organization_required",
                "organizationId is required for organization target config.",
                status_code=400,
            )
        if target.organization_id != body.organization_id:
            raise CloudApiError(
                "target_organization_mismatch",
                "Target does not belong to the requested organization.",
                status_code=403,
            )
        repo_config = await get_organization_cloud_repo_config(
            db,
            organization_id=body.organization_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
    elif body.organization_id is not None:
        raise CloudApiError(
            "invalid_owner_scope",
            "organizationId is only valid for organization target config.",
            status_code=400,
        )
    else:
        repo_config = await get_cloud_repo_config(
            db,
            user_id=user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
    env_vars = repo_config.env_vars if repo_config is not None and repo_config.configured else {}
    tracked_files = [
        TargetConfigTrackedFileModel(
            relative_path=item.relative_path,
            content=item.content,
            content_sha256=item.content_sha256,
            byte_size=item.byte_size,
        )
        for item in (repo_config.tracked_files if repo_config is not None else ())
    ]
    setup_script = repo_config.setup_script if repo_config is not None else ""
    run_command = repo_config.run_command if repo_config is not None else ""
    env_vars_version = repo_config.env_vars_version if repo_config is not None else 0
    files_version = repo_config.files_version if repo_config is not None else 0

    git_credential: TargetConfigGitCredentialModel | None = None
    if body.include_git_credentials:
        github_grant = await get_ready_github_grant_for_user(db, user_id=user.id)
        if github_grant is None:
            raise CloudApiError(
                "github_link_required",
                "Linked GitHub account is missing an access token.",
                status_code=400,
            )
        git_user_name, git_user_email = resolve_git_identity(
            user,
            github_grant,
        )
        git_credential = TargetConfigGitCredentialModel(
            provider=SUPPORTED_GIT_PROVIDER,
            access_token=github_grant.access_token,
            username=git_user_name,
            email=git_user_email,
        )

    runtime_config = None
    if target.sandbox_profile_id is not None:
        runtime_config = await runtime_config_fragment_for_profile(
            db,
            sandbox_profile_id=target.sandbox_profile_id,
        )
        if runtime_config is None:
            await refresh_profile_runtime_config(
                db,
                sandbox_profile_id=target.sandbox_profile_id,
                actor_user_id=user.id,
                reason="target_config_materialization",
            )
            runtime_config = await runtime_config_fragment_for_profile(
                db,
                sandbox_profile_id=target.sandbox_profile_id,
            )
        if runtime_config is None:
            raise CloudApiError(
                "runtime_config_missing",
                "Managed targets require a materialized runtime config.",
                status_code=409,
            )
        runtime_config = runtime_config.model_copy(update={"target_id": str(target.id)})

    if runtime_config is None:
        binding_count = 0
        warning_count = 0
        plugin_package_count = 0
        mcp_materialization_version = 0
    else:
        manifest = runtime_config.manifest
        mcp_servers = manifest.get("mcpServers")
        warnings = manifest.get("warnings")
        skills = manifest.get("skills")
        binding_count = len(mcp_servers) if isinstance(mcp_servers, list) else 0
        warning_count = len(warnings) if isinstance(warnings, list) else 0
        plugin_package_count = len(skills) if isinstance(skills, list) else 0
        mcp_materialization_version = runtime_config.sequence
    required_tools = _required_tools(
        include_git=body.include_git_credentials,
        mcp_binding_count=binding_count,
        plugin_package_count=plugin_package_count,
    )

    summary = TargetConfigSummaryModel(
        env_var_count=len(env_vars),
        tracked_file_count=len(tracked_files),
        has_git_credential=git_credential is not None,
        mcp_binding_count=binding_count,
        mcp_warning_count=warning_count,
        required_tools=required_tools,
    )

    plan = TargetConfigMaterializationPlan(
        target_config_id="pending",
        target_id=str(target.id),
        config_version=0,
        workspace_root=workspace_root,
        repo=TargetConfigRepoModel(provider=git_provider, owner=git_owner, name=git_repo_name),
        env_vars=env_vars,
        tracked_files=tracked_files,
        setup_script=setup_script,
        run_command=run_command,
        git_credential=git_credential,
        runtime_config=runtime_config,
        readiness_requirements={tool: True for tool in required_tools},
    )
    config = await target_config_store.upsert_target_config(
        db,
        target_id=target.id,
        user_id=user.id,
        organization_id=target.organization_id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        workspace_root=workspace_root,
        payload_ciphertext=encrypt_json({"pending": True}),
        summary_json=summary.model_dump_json(),
        env_vars_version=env_vars_version,
        files_version=files_version,
        mcp_materialization_version=mcp_materialization_version,
    )

    finalized_plan = plan.model_copy(
        update={
            "target_config_id": str(config.id),
            "config_version": config.config_version,
        }
    )
    updated_config = await target_config_store.update_target_config_payload(
        db,
        config_id=config.id,
        payload_ciphertext=encrypt_json(finalized_plan.model_dump(mode="json", by_alias=True)),
        summary_json=summary.model_dump_json(),
    )
    if updated_config is None:
        raise CloudApiError(
            "target_config_not_found",
            "Target config was not found after materialization plan creation.",
            status_code=500,
        )
    config = updated_config

    command = await enqueue_command(
        db,
        user=user,
        body=CreateCloudCommandRequest.model_validate(
            {
                "idempotencyKey": _command_idempotency_key(
                    requested=body.idempotency_key,
                    target_config_id=config.id,
                    version=config.config_version,
                ),
                "targetId": str(target.id),
                "kind": CloudCommandKind.materialize_environment.value,
                "payload": {
                    "targetConfigId": str(config.id),
                    "configVersion": config.config_version,
                },
                "source": body.source,
            }
        ),
    )
    queued = await target_config_store.mark_target_config_queued(
        db,
        config_id=config.id,
        command_id=command.id,
    )
    if queued is None:
        raise CloudApiError(
            "target_config_not_found",
            "Target config was not found after command creation.",
            status_code=500,
        )
    return MaterializeTargetConfigResponse(
        target_config=target_config_payload(queued),
        command=command_response_payload(command),
    )


async def worker_target_config_plan(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    config_id: UUID,
    command_id: UUID,
    config_version: int,
    lease_id: str,
) -> TargetConfigMaterializationPlan:
    await _require_active_worker_target(db, auth=auth)
    await _require_materialization_command(
        db,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        config_id=config_id,
        command_id=command_id,
        config_version=config_version,
        lease_id=lease_id,
    )
    config = await target_config_store.get_target_config_for_worker_command(
        db,
        config_id=config_id,
        target_id=auth.target_id,
        command_id=command_id,
        config_version=config_version,
    )
    if config is None:
        raise CloudApiError(
            "target_config_not_found",
            "Target config not found.",
            status_code=404,
        )
    return TargetConfigMaterializationPlan.model_validate(decrypt_json(config.payload_ciphertext))


async def record_worker_target_config_status(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    config_id: UUID,
    body: WorkerTargetConfigStatusRequest,
) -> WorkerTargetConfigStatusResponse:
    await _require_active_worker_target(db, auth=auth)
    await _require_materialization_command(
        db,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        config_id=config_id,
        command_id=body.command_id,
        config_version=body.config_version,
        lease_id=body.lease_id,
    )
    config = await target_config_store.mark_target_config_status(
        db,
        config_id=config_id,
        target_id=auth.target_id,
        command_id=body.command_id,
        config_version=body.config_version,
        status=body.status,
        error_code=body.error_code,
        error_message=body.error_message,
    )
    if config is None:
        raise CloudApiError(
            "target_config_not_found",
            "Target config not found.",
            status_code=404,
        )
    return WorkerTargetConfigStatusResponse(
        target_config_id=str(config.id),
        status=config.materialization_status,
        updated=True,
    )
