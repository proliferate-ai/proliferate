from __future__ import annotations

import hashlib
import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudCommandActorKind, CloudCommandKind, CloudCommandSource
from proliferate.db.store import cloud_sandbox_profiles as sandbox_profile_store
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_mcp import auth as mcp_auth_store
from proliferate.db.store.cloud_mcp.connections import (
    list_enabled_connections_for_organization_profile,
    list_enabled_connections_for_personal_profile,
)
from proliferate.db.store.cloud_plugins.configured_items import (
    list_enabled_plugins_for_organization_profile,
    list_enabled_plugins_for_personal_profile,
)
from proliferate.db.store.cloud_runtime_config import artifacts as artifact_store
from proliferate.db.store.cloud_runtime_config import revisions as revision_store
from proliferate.db.store.cloud_runtime_config.revisions import (
    SandboxProfileRuntimeConfigRevisionSnapshot,
)
from proliferate.db.store.cloud_skills.configured_items import (
    list_enabled_skills_for_organization_profile,
    list_enabled_skills_for_personal_profile,
)
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import target_config as target_config_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.commands.domain.rules import compact_command_json
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.live.service import publish_command_status_after_commit
from proliferate.server.cloud.mcp_catalog.availability import catalog_entry_is_configured
from proliferate.server.cloud.mcp_catalog.catalog import build_connector_catalog
from proliferate.server.cloud.plugins.catalog.service import plugin_packages_for_catalog_entries
from proliferate.server.cloud.runtime_config.domain.manifest import (
    CompiledRuntimeConfigManifest,
    compile_runtime_config_manifest,
)
from proliferate.server.cloud.runtime_config.domain.resolver import (
    McpConnectionSnapshot,
    PluginConfiguredItemSnapshot,
    ResolverInput,
    SandboxProfileResolverSnapshot,
    SkillConfiguredItemSnapshot,
    resolve_runtime_config,
)
from proliferate.server.cloud.runtime_config.models import (
    RuntimeConfigArtifactRefModel,
    RuntimeConfigArtifactResponse,
    RuntimeConfigCredentialValueModel,
    RuntimeConfigMaterializationFragment,
    RuntimeConfigStatusResponse,
    WorkerRuntimeConfigCredentialMaterializationRequest,
    WorkerRuntimeConfigCredentialMaterializationResponse,
    WorkerRuntimeConfigStatusRequest,
    WorkerRuntimeConfigStatusResponse,
    parse_json_dict,
    runtime_config_revision_model,
)
from proliferate.server.cloud.target_config.models import (
    TargetConfigMaterializationPlan,
    TargetConfigSummaryModel,
)
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.server.cloud.worker.slot_guard import require_current_managed_worker_slot
from proliferate.utils.crypto import decrypt_json, encrypt_json


async def refresh_profile_runtime_config(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    actor_user_id: UUID | None,
    reason: str,
) -> RuntimeConfigStatusResponse:
    del reason
    profile = await _load_profile(db, sandbox_profile_id)
    compiled = await compile_profile_runtime_config(db, profile=profile)
    revision, _created = await revision_store.upsert_revision_and_current(
        db,
        sandbox_profile_id=profile.id,
        content_hash=compiled.content_hash,
        manifest_json=compiled.manifest_json,
        warnings_json=compiled.warnings_json,
        source="server",
        generated_by_user_id=actor_user_id,
    )
    for artifact in compiled.artifact_payloads:
        await artifact_store.upsert_artifact(
            db,
            revision_id=revision.id,
            artifact_hash=artifact.hash,
            content_type=artifact.content_type,
            byte_size=artifact.byte_size,
            payload_ciphertext=encrypt_json(
                {
                    "content": artifact.content,
                    "contentType": artifact.content_type,
                    "hash": artifact.hash,
                    "sourceRef": artifact.source_ref,
                    "resourceId": artifact.resource_id,
                    "displayName": artifact.display_name,
                }
            ),
        )
    if compiled.blocking_errors:
        await _mark_primary_target_runtime_config_failed(
            db,
            profile_id=profile.id,
            sequence=revision.sequence,
            revision_id=revision.id,
            blocking_errors=compiled.blocking_errors,
        )
        return RuntimeConfigStatusResponse(
            sandbox_profile_id=str(profile.id),
            current_revision=runtime_config_revision_model(revision),
            manifest=parse_json_dict(revision.manifest_json),
            warnings=parse_json_dict(revision.warnings_json),
        )
    await _mark_primary_target_runtime_config_pending(
        db,
        profile_id=profile.id,
        sequence=revision.sequence,
        revision_id=revision.id,
    )
    await _queue_primary_target_runtime_config_materialization(
        db,
        profile=profile,
        revision=revision,
        actor_user_id=actor_user_id,
    )
    return RuntimeConfigStatusResponse(
        sandbox_profile_id=str(profile.id),
        current_revision=runtime_config_revision_model(revision),
        manifest=parse_json_dict(revision.manifest_json),
        warnings=parse_json_dict(revision.warnings_json),
    )


async def get_profile_runtime_config_status(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
) -> RuntimeConfigStatusResponse:
    profile = await _load_profile(db, sandbox_profile_id)
    _current, revision = await revision_store.get_current(
        db,
        sandbox_profile_id=profile.id,
    )
    return RuntimeConfigStatusResponse(
        sandbox_profile_id=str(profile.id),
        current_revision=runtime_config_revision_model(revision) if revision else None,
        manifest=parse_json_dict(revision.manifest_json) if revision else None,
        warnings=parse_json_dict(revision.warnings_json) if revision else None,
    )


async def compile_profile_runtime_config(
    db: AsyncSession,
    *,
    profile: sandbox_profile_store.SandboxProfileSnapshot,
) -> CompiledRuntimeConfigManifest:
    entries = tuple(
        entry for entry in build_connector_catalog() if catalog_entry_is_configured(entry)
    )
    packages = tuple(plugin_packages_for_catalog_entries(list(entries)))
    if profile.owner_scope == "personal":
        if profile.owner_user_id is None:
            raise CloudApiError(
                "runtime_config_profile_invalid",
                "Personal sandbox profile is missing owner_user_id.",
                status_code=409,
            )
        mcp_records = await list_enabled_connections_for_personal_profile(
            db, profile.owner_user_id
        )
        skill_records = await list_enabled_skills_for_personal_profile(db, profile.owner_user_id)
        plugin_records = await list_enabled_plugins_for_personal_profile(db, profile.owner_user_id)
    else:
        if profile.organization_id is None:
            raise CloudApiError(
                "runtime_config_profile_invalid",
                "Organization sandbox profile is missing organization_id.",
                status_code=409,
            )
        mcp_records = await list_enabled_connections_for_organization_profile(
            db,
            profile.organization_id,
        )
        skill_records = await list_enabled_skills_for_organization_profile(
            db,
            profile.organization_id,
        )
        plugin_records = await list_enabled_plugins_for_organization_profile(
            db,
            profile.organization_id,
        )
    resolver_input = ResolverInput(
        sandbox_profile=SandboxProfileResolverSnapshot(
            id=str(profile.id),
            owner_scope=profile.owner_scope,
            owner_user_id=str(profile.owner_user_id) if profile.owner_user_id else None,
            organization_id=str(profile.organization_id) if profile.organization_id else None,
        ),
        mcp_connections=tuple(_mcp_resolver_snapshot(record) for record in mcp_records),
        skill_configured_items=tuple(_skill_resolver_snapshot(record) for record in skill_records),
        plugin_configured_items=tuple(
            _plugin_resolver_snapshot(record) for record in plugin_records
        ),
        catalog=entries,
        plugin_packages=packages,
    )
    plan = resolve_runtime_config(resolver_input)
    return compile_runtime_config_manifest(
        plan,
        sandbox_profile_id=str(profile.id),
    )


async def runtime_config_fragment_for_profile(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
) -> RuntimeConfigMaterializationFragment | None:
    _current, revision = await revision_store.get_current(
        db,
        sandbox_profile_id=sandbox_profile_id,
    )
    if revision is None:
        return None
    return await runtime_config_fragment_for_revision(db, revision_id=revision.id)


async def runtime_config_fragment_for_revision(
    db: AsyncSession,
    *,
    revision_id: UUID,
) -> RuntimeConfigMaterializationFragment:
    revision = await revision_store.get_revision_by_id(db, revision_id)
    if revision is None:
        raise CloudApiError(
            "runtime_config_revision_not_found",
            "Runtime config revision not found.",
            status_code=404,
        )
    manifest = parse_json_dict(revision.manifest_json) or {}
    artifacts = manifest.get("artifacts")
    artifact_refs = [
        RuntimeConfigArtifactRefModel(
            hash=str(item.get("hash", "")),
            content_type=str(item.get("contentType", "")),
            byte_size=int(item.get("byteSize", 0)),
            source_ref=str(item["sourceRef"]) if item.get("sourceRef") is not None else None,
            resource_id=str(item["resourceId"]) if item.get("resourceId") is not None else None,
            display_name=(
                str(item["displayName"]) if item.get("displayName") is not None else None
            ),
        )
        for item in (artifacts if isinstance(artifacts, list) else [])
        if isinstance(item, dict)
    ]
    credential_refs = _credential_refs_from_manifest(manifest)
    return RuntimeConfigMaterializationFragment(
        revision_id=str(revision.id),
        sandbox_profile_id=str(revision.sandbox_profile_id),
        target_id=None,
        sequence=revision.sequence,
        content_hash=revision.content_hash,
        manifest=manifest,
        artifact_refs=artifact_refs,
        credential_refs=credential_refs,
    )


async def worker_runtime_config_fragment(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    revision_id: UUID,
) -> RuntimeConfigMaterializationFragment:
    await require_current_managed_worker_slot(db, auth=auth)
    await _require_current_worker_revision(db, auth=auth, revision_id=revision_id)
    return await runtime_config_fragment_for_revision(db, revision_id=revision_id)


async def worker_runtime_config_artifact(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    revision_id: UUID,
    artifact_hash: str,
) -> RuntimeConfigArtifactResponse:
    await require_current_managed_worker_slot(db, auth=auth)
    revision = await _require_current_worker_revision(db, auth=auth, revision_id=revision_id)
    artifact = await artifact_store.get_artifact(
        db,
        revision_id=revision.id,
        artifact_hash=artifact_hash,
    )
    if artifact is None:
        raise CloudApiError(
            "runtime_config_artifact_not_found",
            "Runtime config artifact not found.",
            status_code=404,
        )
    payload = decrypt_json(artifact.payload_ciphertext)
    content = payload.get("content")
    if not isinstance(content, str):
        raise CloudApiError(
            "runtime_config_artifact_invalid",
            "Runtime config artifact payload is invalid.",
            status_code=500,
        )
    _raise_if_artifact_integrity_invalid(artifact, payload=payload, content=content)
    return RuntimeConfigArtifactResponse(
        hash=artifact.artifact_hash,
        content_type=artifact.content_type,
        byte_size=artifact.byte_size,
        source_ref=str(payload["sourceRef"]) if payload.get("sourceRef") is not None else None,
        resource_id=str(payload["resourceId"]) if payload.get("resourceId") is not None else None,
        display_name=(
            str(payload["displayName"]) if payload.get("displayName") is not None else None
        ),
        content=content,
    )


async def worker_runtime_config_credentials(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    revision_id: UUID,
    body: WorkerRuntimeConfigCredentialMaterializationRequest,
) -> WorkerRuntimeConfigCredentialMaterializationResponse:
    await require_current_managed_worker_slot(db, auth=auth)
    revision = await _require_current_worker_revision(db, auth=auth, revision_id=revision_id)
    manifest = parse_json_dict(revision.manifest_json) or {}
    allowed_refs = {
        str(ref["credentialRef"])
        for ref in _credential_refs_from_manifest(manifest)
        if isinstance(ref.get("credentialRef"), str)
    }
    credentials: list[RuntimeConfigCredentialValueModel] = []
    missing: list[str] = []
    seen: set[str] = set()
    for credential_ref in body.credential_refs:
        if credential_ref in seen:
            continue
        seen.add(credential_ref)
        if credential_ref not in allowed_refs:
            missing.append(credential_ref)
            continue
        value = await _resolve_runtime_credential_ref(db, credential_ref)
        if value is None:
            missing.append(credential_ref)
            continue
        credentials.append(
            RuntimeConfigCredentialValueModel(
                credential_ref=credential_ref,
                value=value,
            )
        )
    return WorkerRuntimeConfigCredentialMaterializationResponse(
        credentials=credentials,
        missing_credential_refs=missing,
    )


async def record_worker_runtime_config_status(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    revision_id: UUID,
    body: WorkerRuntimeConfigStatusRequest,
) -> WorkerRuntimeConfigStatusResponse:
    await require_current_managed_worker_slot(db, auth=auth)
    revision = await _require_worker_revision(db, auth=auth, revision_id=revision_id)
    if not await _worker_revision_is_current(db, revision=revision):
        return WorkerRuntimeConfigStatusResponse(
            revision_id=str(revision.id),
            status="stale",
            updated=False,
        )
    error_message = body.error_message
    if body.status == "failed":
        details = {
            "missingArtifacts": body.missing_artifacts,
            "missingCredentials": body.missing_credentials,
            "errorMessage": body.error_message,
        }
        error_message = json.dumps(
            details,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
    state = await agent_auth_store.record_runtime_config_worker_status(
        db,
        sandbox_profile_id=revision.sandbox_profile_id,
        target_id=auth.target_id,
        sequence=revision.sequence,
        revision_id=revision.id,
        worker_id=auth.worker_id,
        status=body.status,
        error_code=body.error_code,
        error_message=error_message,
    )
    return WorkerRuntimeConfigStatusResponse(
        revision_id=str(revision.id),
        status=state.runtime_config_status,
        updated=True,
    )


def _mcp_resolver_snapshot(record) -> McpConnectionSnapshot:  # noqa: ANN001
    auth_kind = record.auth.auth_kind if record.auth else None
    auth_status = record.auth.auth_status if record.auth else None
    auth_version = record.auth.auth_version if record.auth else None
    return McpConnectionSnapshot(
        id=str(record.id),
        owner_scope=record.owner_scope,
        owner_user_id=str(record.owner_user_id) if record.owner_user_id else None,
        organization_id=str(record.organization_id) if record.organization_id else None,
        connection_id=record.connection_id,
        catalog_entry_id=record.catalog_entry_id,
        catalog_entry_version=record.catalog_entry_version,
        server_name=record.server_name,
        enabled=record.enabled,
        public_to_org=record.public_to_org,
        public_organization_id=(
            str(record.public_organization_id) if record.public_organization_id else None
        ),
        public_status=record.public_status,
        settings_json=record.settings_json,
        config_version=record.config_version,
        auth_kind=auth_kind,
        auth_status=auth_status,
        auth_version=auth_version,
    )


def _skill_resolver_snapshot(record) -> SkillConfiguredItemSnapshot:  # noqa: ANN001
    return SkillConfiguredItemSnapshot(
        id=str(record.id),
        owner_scope=record.owner_scope,
        owner_user_id=str(record.owner_user_id) if record.owner_user_id else None,
        organization_id=str(record.organization_id) if record.organization_id else None,
        skill_source_kind=record.skill_source_kind,
        skill_id=record.skill_id,
        skill_version=record.skill_version,
        plugin_id=record.plugin_id,
        plugin_version=record.plugin_version,
        enabled=record.enabled,
        public_to_org=record.public_to_org,
        public_organization_id=(
            str(record.public_organization_id) if record.public_organization_id else None
        ),
        public_status=record.public_status,
        user_skill_payload_ref=record.user_skill_payload_ref,
        source_snapshot_json=record.source_snapshot_json,
        config_version=record.config_version,
    )


def _plugin_resolver_snapshot(record) -> PluginConfiguredItemSnapshot:  # noqa: ANN001
    return PluginConfiguredItemSnapshot(
        id=str(record.id),
        owner_scope=record.owner_scope,
        owner_user_id=str(record.owner_user_id) if record.owner_user_id else None,
        organization_id=str(record.organization_id) if record.organization_id else None,
        plugin_id=record.plugin_id,
        plugin_version=record.plugin_version,
        enabled=record.enabled,
        public_to_org=record.public_to_org,
        public_organization_id=(
            str(record.public_organization_id) if record.public_organization_id else None
        ),
        public_status=record.public_status,
        config_version=record.config_version,
    )


async def _load_profile(
    db: AsyncSession,
    sandbox_profile_id: UUID,
) -> sandbox_profile_store.SandboxProfileSnapshot:
    profile = await sandbox_profile_store.load_sandbox_profile_by_id(db, sandbox_profile_id)
    if profile is None:
        raise CloudApiError(
            "sandbox_profile_not_found",
            "Sandbox profile not found.",
            status_code=404,
        )
    return profile


async def _mark_primary_target_runtime_config_pending(
    db: AsyncSession,
    *,
    profile_id: UUID,
    sequence: int,
    revision_id: UUID,
) -> None:
    target_id = await sandbox_profile_store.load_primary_target_id(db, profile_id)
    if target_id is None:
        return
    await agent_auth_store.mark_runtime_config_pending(
        db,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        sequence=sequence,
        revision_id=revision_id,
    )


async def _mark_primary_target_runtime_config_failed(
    db: AsyncSession,
    *,
    profile_id: UUID,
    sequence: int,
    revision_id: UUID,
    blocking_errors: tuple[dict[str, object], ...],
) -> None:
    target_id = await sandbox_profile_store.load_primary_target_id(db, profile_id)
    if target_id is None:
        return
    await agent_auth_store.mark_runtime_config_failed(
        db,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        sequence=sequence,
        revision_id=revision_id,
        error_code=_first_blocking_error_code(blocking_errors),
        error_message=json.dumps(
            {"blockingErrors": list(blocking_errors)},
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ),
    )


def _first_blocking_error_code(blocking_errors: tuple[dict[str, object], ...]) -> str:
    for error in blocking_errors:
        code = error.get("code")
        if isinstance(code, str) and code:
            return code
    return "runtime_config_blocked"


async def _queue_primary_target_runtime_config_materialization(
    db: AsyncSession,
    *,
    profile: sandbox_profile_store.SandboxProfileSnapshot,
    revision: SandboxProfileRuntimeConfigRevisionSnapshot,
    actor_user_id: UUID | None,
) -> None:
    target_id = await sandbox_profile_store.load_primary_target_id(db, profile.id)
    if target_id is None:
        return
    target = await targets_store.get_target_by_id(db, target_id)
    if target is None:
        return
    configs = await target_config_store.list_target_configs(db, target_id=target.id)
    for config in configs:
        updated = await _update_target_config_runtime_fragment(
            db,
            config=config,
            revision=revision,
        )
        if updated is None:
            continue
        command = await _enqueue_runtime_config_materialization_command(
            db,
            target=target,
            config=updated,
            revision=revision,
            actor_user_id=actor_user_id,
        )
        queued = await target_config_store.mark_target_config_queued(
            db,
            config_id=updated.id,
            command_id=command.id,
        )
        if queued is None:
            continue
        await _record_runtime_config_command(
            db,
            profile_id=profile.id,
            target_id=target.id,
            command_id=command.id,
        )
        await publish_command_status_after_commit(db, command)


async def _update_target_config_runtime_fragment(
    db: AsyncSession,
    *,
    config: target_config_store.CloudTargetConfigSnapshot,
    revision: SandboxProfileRuntimeConfigRevisionSnapshot,
) -> target_config_store.CloudTargetConfigSnapshot | None:
    try:
        payload = decrypt_json(config.payload_ciphertext)
        plan = TargetConfigMaterializationPlan.model_validate(payload)
    except (TypeError, ValueError):
        return None
    runtime_config = await runtime_config_fragment_for_revision(db, revision_id=revision.id)
    runtime_config = runtime_config.model_copy(update={"target_id": str(config.target_id)})
    manifest = runtime_config.manifest
    mcp_servers = manifest.get("mcpServers")
    warnings = manifest.get("warnings")
    skills = manifest.get("skills")
    binding_count = len(mcp_servers) if isinstance(mcp_servers, list) else 0
    warning_count = len(warnings) if isinstance(warnings, list) else 0
    skill_count = len(skills) if isinstance(skills, list) else 0
    new_version = config.config_version + 1
    updated_plan = plan.model_copy(
        update={
            "config_version": new_version,
            "runtime_config": runtime_config,
            "mcp": None,
            "skills": [],
        }
    )
    summary = _runtime_config_summary(
        config.summary_json,
        binding_count=binding_count,
        warning_count=warning_count,
        skill_count=skill_count,
    )
    return await target_config_store.replace_target_config_payload_for_runtime_config(
        db,
        config_id=config.id,
        payload_ciphertext=encrypt_json(updated_plan.model_dump(mode="json", by_alias=True)),
        summary_json=summary.model_dump_json(),
        mcp_materialization_version=revision.sequence,
    )


def _runtime_config_summary(
    summary_json: str,
    *,
    binding_count: int,
    warning_count: int,
    skill_count: int,
) -> TargetConfigSummaryModel:
    try:
        summary = TargetConfigSummaryModel.model_validate_json(summary_json)
    except (TypeError, ValueError):
        summary = TargetConfigSummaryModel(
            env_var_count=0,
            tracked_file_count=0,
            has_git_credential=False,
            agent_credential_providers=[],
            mcp_binding_count=0,
            mcp_warning_count=0,
            required_tools=[],
        )
    required_tools = set(summary.required_tools)
    if binding_count or skill_count:
        required_tools.add("node")
    return summary.model_copy(
        update={
            "mcp_binding_count": binding_count,
            "mcp_warning_count": warning_count,
            "required_tools": sorted(required_tools),
        }
    )


async def _enqueue_runtime_config_materialization_command(
    db: AsyncSession,
    *,
    target: targets_store.CloudTargetSnapshot,
    config: target_config_store.CloudTargetConfigSnapshot,
    revision: SandboxProfileRuntimeConfigRevisionSnapshot,
    actor_user_id: UUID | None,
) -> commands_store.CloudCommandSnapshot:
    idempotency_scope = f"target:{target.id}:runtime-config:config:{config.id}"
    idempotency_key = f"runtime-config:{revision.id}:config-v{config.config_version}"
    existing = await commands_store.get_command_by_idempotency(
        db,
        idempotency_scope=idempotency_scope,
        idempotency_key=idempotency_key,
    )
    if existing is not None:
        return existing
    return await commands_store.create_command(
        db,
        idempotency_scope=idempotency_scope,
        idempotency_key=idempotency_key,
        target_id=target.id,
        organization_id=target.organization_id,
        actor_user_id=actor_user_id,
        actor_kind=CloudCommandActorKind.system.value,
        source=CloudCommandSource.automation.value,
        workspace_id=None,
        session_id=None,
        cloud_workspace_id=None,
        kind=CloudCommandKind.materialize_environment.value,
        payload_json=compact_command_json(
            {
                "targetConfigId": str(config.id),
                "configVersion": config.config_version,
            }
        ),
        observed_event_seq=None,
        preconditions_json=None,
        authorization_context_json=compact_command_json(
            {
                "actorUserId": str(actor_user_id) if actor_user_id else None,
                "runtimeConfigRevisionId": str(revision.id),
            }
        ),
    )


async def _record_runtime_config_command(
    db: AsyncSession,
    *,
    profile_id: UUID,
    target_id: UUID,
    command_id: UUID,
) -> None:
    await agent_auth_store.record_runtime_config_command(
        db,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        command_id=command_id,
    )


async def _require_worker_revision(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    revision_id: UUID,
) -> SandboxProfileRuntimeConfigRevisionSnapshot:
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None or target.sandbox_profile_id is None:
        raise CloudApiError(
            "runtime_config_target_not_found",
            "Worker target is not attached to a sandbox profile.",
            status_code=404,
        )
    revision = await revision_store.get_revision_by_id(db, revision_id)
    if revision is None or revision.sandbox_profile_id != target.sandbox_profile_id:
        raise CloudApiError(
            "runtime_config_revision_not_found",
            "Runtime config revision not found.",
            status_code=404,
        )
    return revision


async def _require_current_worker_revision(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    revision_id: UUID,
) -> SandboxProfileRuntimeConfigRevisionSnapshot:
    revision = await _require_worker_revision(db, auth=auth, revision_id=revision_id)
    if not await _worker_revision_is_current(db, revision=revision):
        raise CloudApiError(
            "runtime_config_revision_stale",
            "Runtime config revision is no longer current for this target.",
            status_code=409,
        )
    return revision


async def _worker_revision_is_current(
    db: AsyncSession,
    *,
    revision: SandboxProfileRuntimeConfigRevisionSnapshot,
) -> bool:
    _current, current_revision = await revision_store.get_current(
        db,
        sandbox_profile_id=revision.sandbox_profile_id,
    )
    return current_revision is not None and current_revision.id == revision.id


def _raise_if_artifact_integrity_invalid(
    artifact: artifact_store.SandboxProfileRuntimeConfigArtifactSnapshot,
    *,
    payload: dict[str, object],
    content: str,
) -> None:
    expected_hash = artifact.artifact_hash
    byte_size = len(content.encode("utf-8"))
    payload_hash = payload.get("hash")
    payload_content_type = payload.get("contentType")
    if (
        byte_size != artifact.byte_size
        or _artifact_content_hash(content) != expected_hash
        or (payload_hash is not None and payload_hash != expected_hash)
        or (payload_content_type is not None and payload_content_type != artifact.content_type)
    ):
        raise CloudApiError(
            "runtime_config_artifact_integrity_mismatch",
            "Runtime config artifact payload does not match its recorded hash.",
            status_code=500,
        )


def _artifact_content_hash(content: str) -> str:
    return f"sha256:{hashlib.sha256(content.encode('utf-8')).hexdigest()}"


def _credential_refs_from_manifest(manifest: dict[str, object]) -> list[dict[str, object]]:
    refs: list[dict[str, object]] = []
    servers = manifest.get("mcpServers")
    if not isinstance(servers, list):
        return refs
    for server in servers:
        if not isinstance(server, dict):
            continue
        server_refs = server.get("credentialRefs")
        if isinstance(server_refs, list):
            refs.extend(item for item in server_refs if isinstance(item, dict))
    return refs


async def _resolve_runtime_credential_ref(
    db: AsyncSession,
    credential_ref: str,
) -> str | None:
    parts = credential_ref.split(":", 2)
    if len(parts) != 3 or parts[0] != "mcp":
        return None
    try:
        connection_db_id = UUID(parts[1])
    except ValueError:
        return None
    field_name = parts[2]
    auth = await mcp_auth_store.load_connection_auth(
        db,
        connection_db_id=connection_db_id,
    )
    if auth is not None and auth.auth_status == "ready" and auth.payload_ciphertext:
        payload = decrypt_json(auth.payload_ciphertext)
    else:
        return None
    if not isinstance(payload, dict):
        return None
    return _credential_value_from_payload(payload, field_name)


def _credential_value_from_payload(payload: dict[str, object], field_name: str) -> str | None:
    secret_fields = payload.get("secretFields")
    if isinstance(secret_fields, dict):
        value = secret_fields.get(field_name)
        if isinstance(value, str) and value:
            return value
    candidate_keys = [field_name]
    if "_" in field_name:
        head, *tail = field_name.split("_")
        candidate_keys.append(head + "".join(part.title() for part in tail))
    elif field_name and any(char.isupper() for char in field_name):
        snake = "".join(
            f"_{char.lower()}" if char.isupper() else char for char in field_name
        ).lstrip("_")
        candidate_keys.append(snake)
    for key in candidate_keys:
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return None
