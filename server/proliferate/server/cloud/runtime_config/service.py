from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_auth import SandboxProfileTargetState
from proliferate.db.store import cloud_sandbox_profiles as sandbox_profile_store
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
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.errors import CloudApiError
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
    RuntimeConfigMaterializationFragment,
    RuntimeConfigStatusResponse,
    WorkerRuntimeConfigStatusRequest,
    WorkerRuntimeConfigStatusResponse,
    parse_json_dict,
    runtime_config_revision_model,
)
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.server.cloud.worker.slot_guard import require_current_managed_worker_slot
from proliferate.utils.crypto import decrypt_json, encrypt_json
from proliferate.utils.time import utcnow


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
                }
            ),
        )
    await _mark_primary_target_runtime_config_pending(
        db,
        profile_id=profile.id,
        sequence=revision.sequence,
        revision_id=revision.id,
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
        )
        for item in (artifacts if isinstance(artifacts, list) else [])
        if isinstance(item, dict)
    ]
    credential_refs = _credential_refs_from_manifest(manifest)
    return RuntimeConfigMaterializationFragment(
        revision_id=str(revision.id),
        sandbox_profile_id=str(revision.sandbox_profile_id),
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
    await _require_worker_revision(db, auth=auth, revision_id=revision_id)
    return await runtime_config_fragment_for_revision(db, revision_id=revision_id)


async def worker_runtime_config_artifact(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    revision_id: UUID,
    artifact_hash: str,
) -> RuntimeConfigArtifactResponse:
    await require_current_managed_worker_slot(db, auth=auth)
    revision = await _require_worker_revision(db, auth=auth, revision_id=revision_id)
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
    return RuntimeConfigArtifactResponse(
        hash=artifact.artifact_hash,
        content_type=artifact.content_type,
        byte_size=artifact.byte_size,
        content=content,
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
    row = (
        await db.execute(
            select(SandboxProfileTargetState)
            .where(
                SandboxProfileTargetState.sandbox_profile_id == revision.sandbox_profile_id,
                SandboxProfileTargetState.target_id == auth.target_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = SandboxProfileTargetState(
            sandbox_profile_id=revision.sandbox_profile_id,
            target_id=auth.target_id,
            desired_agent_auth_revision=0,
            applied_agent_auth_revision=None,
            agent_auth_status="applied",
            agent_auth_force_restart_required=False,
            applied_runtime_config_sequence=0,
            applied_runtime_config_revision_id=None,
            runtime_config_status=body.status,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    row.runtime_config_status = body.status
    row.last_runtime_config_worker_id = auth.worker_id
    row.last_runtime_config_attempted_at = now
    row.last_runtime_config_error_code = body.error_code
    row.last_runtime_config_error_message = body.error_message
    if body.status == "applied":
        row.applied_runtime_config_sequence = revision.sequence
        row.applied_runtime_config_revision_id = str(revision.id)
        row.last_runtime_config_applied_at = now
        row.last_runtime_config_error_code = None
        row.last_runtime_config_error_message = None
    elif body.status == "failed":
        details = {
            "missingArtifacts": body.missing_artifacts,
            "missingCredentials": body.missing_credentials,
            "errorMessage": body.error_message,
        }
        row.last_runtime_config_error_message = json.dumps(
            details,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
    row.updated_at = now
    await db.flush()
    return WorkerRuntimeConfigStatusResponse(
        revision_id=str(revision.id),
        status=row.runtime_config_status,
        updated=True,
    )


def _mcp_resolver_snapshot(record) -> McpConnectionSnapshot:  # noqa: ANN001
    auth_kind = record.auth.auth_kind if record.auth else None
    auth_status = record.auth.auth_status if record.auth else None
    auth_version = record.auth.auth_version if record.auth else None
    if auth_status is None and record.payload_ciphertext:
        auth_kind = "secret"
        auth_status = "ready"
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
    row = (
        await db.execute(
            select(SandboxProfileTargetState)
            .where(
                SandboxProfileTargetState.sandbox_profile_id == profile_id,
                SandboxProfileTargetState.target_id == target_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return
    if (
        row.applied_runtime_config_revision_id == str(revision_id)
        and row.applied_runtime_config_sequence >= sequence
    ):
        return
    row.runtime_config_status = "pending"
    row.updated_at = utcnow()
    await db.flush()


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
