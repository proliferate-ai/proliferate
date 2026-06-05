from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import CloudCommandActorKind, CloudCommandKind, CloudCommandSource
from proliferate.db.store import cloud_sandbox_profiles as sandbox_profile_store
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_mcp.connections import (
    list_enabled_connections_for_organization_profile,
    list_enabled_connections_for_personal_profile,
)
from proliferate.db.store.cloud_plugins import (
    list_enabled_plugins_for_organization_profile,
    list_enabled_plugins_for_personal_profile,
)
from proliferate.db.store.cloud_runtime_config import artifacts as artifact_store
from proliferate.db.store.cloud_runtime_config import revisions as revision_store
from proliferate.db.store.cloud_runtime_config.revisions import (
    SandboxProfileRuntimeConfigRevisionSnapshot,
)
from proliferate.db.store.cloud_skills import (
    list_enabled_skills_for_organization_profile,
    list_enabled_skills_for_personal_profile,
)
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import target_config as target_config_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.claims.domain.pem import normalize_pem_setting
from proliferate.server.cloud.commands.domain.rules import compact_command_json
from proliferate.server.cloud.commands.wake import enqueue_managed_target_wake_outbox
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.live.service import publish_command_status_after_commit
from proliferate.server.cloud.mcp_catalog.availability import catalog_entry_is_configured
from proliferate.server.cloud.mcp_catalog.catalog import build_connector_catalog
from proliferate.server.cloud.plugins.catalog.service import plugin_packages_for_catalog_entries
from proliferate.server.cloud.runtime_config.artifacts import (
    raise_if_artifact_integrity_invalid,
)
from proliferate.server.cloud.runtime_config.credentials import (
    credential_refs_from_manifest,
    resolve_runtime_credential_ref,
)
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
    DesktopRuntimeConfigApplyResponse,
    RuntimeConfigArtifactRefModel,
    RuntimeConfigMaterializationFragment,
    RuntimeConfigStatusResponse,
    parse_json_dict,
    runtime_config_revision_model,
)
from proliferate.server.cloud.target_config.models import (
    TargetConfigMaterializationPlan,
    TargetConfigSummaryModel,
)
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


async def desktop_runtime_config_apply_request(
    db: AsyncSession,
    *,
    profile: sandbox_profile_store.SandboxProfileSnapshot,
    target_id: UUID | None,
    actor_user_id: UUID,
) -> DesktopRuntimeConfigApplyResponse:
    if profile.owner_scope != "personal" or profile.owner_user_id != actor_user_id:
        raise CloudApiError(
            "runtime_config_desktop_profile_unsupported",
            "Desktop runtime config can only be materialized for the signed-in "
            "user's personal profile.",
            status_code=403,
        )

    resolved_target_id = target_id or profile.primary_target_id
    if resolved_target_id is None:
        raise CloudApiError(
            "runtime_config_target_missing",
            "Sandbox profile does not have a primary target.",
            status_code=409,
        )
    target = await targets_store.get_target_by_id(db, resolved_target_id)
    if target is None or target.sandbox_profile_id != profile.id or target.archived_at is not None:
        raise CloudApiError(
            "runtime_config_target_not_found",
            "Runtime config target was not found for this sandbox profile.",
            status_code=404,
        )

    _current, revision = await revision_store.get_current(
        db,
        sandbox_profile_id=profile.id,
    )
    if revision is None:
        await refresh_profile_runtime_config(
            db,
            sandbox_profile_id=profile.id,
            actor_user_id=actor_user_id,
            reason="desktop_local_session",
        )
        _current, revision = await revision_store.get_current(
            db,
            sandbox_profile_id=profile.id,
        )
    if revision is None:
        raise CloudApiError(
            "runtime_config_revision_missing",
            "Runtime config revision was not created.",
            status_code=500,
        )

    apply_request = await runtime_config_apply_request_for_revision(
        db,
        revision_id=revision.id,
        target_id=resolved_target_id,
        source="desktop",
    )
    revision_payload = apply_request.get("revision")
    if not isinstance(revision_payload, dict):
        raise CloudApiError(
            "runtime_config_apply_request_invalid",
            "Runtime config apply request is invalid.",
            status_code=500,
        )
    return DesktopRuntimeConfigApplyResponse(
        apply_request=apply_request,
        expected_runtime_config_revision=_revision_expectation_from_apply_revision(
            revision_payload
        ),
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
        direct_attach_auth=_direct_attach_auth_payload(),
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
    credential_refs = credential_refs_from_manifest(manifest)
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


async def runtime_config_apply_request_for_revision(
    db: AsyncSession,
    *,
    revision_id: UUID,
    target_id: UUID,
    source: str = "worker",
) -> dict[str, object]:
    fragment = await runtime_config_fragment_for_revision(db, revision_id=revision_id)
    fragment = fragment.model_copy(update={"target_id": str(target_id)})
    artifact_payloads: list[dict[str, object]] = []
    for artifact in await artifact_store.list_artifacts_for_revision(db, revision_id=revision_id):
        payload = decrypt_json(artifact.payload_ciphertext)
        content = payload.get("content")
        if not isinstance(content, str):
            raise CloudApiError(
                "runtime_config_artifact_invalid",
                "Runtime config artifact payload is invalid.",
                status_code=500,
            )
        raise_if_artifact_integrity_invalid(artifact, payload=payload, content=content)
        artifact_payloads.append(
            {
                "hash": artifact.artifact_hash,
                "contentType": artifact.content_type,
                "byteSize": artifact.byte_size,
                "sourceRef": (
                    str(payload["sourceRef"]) if payload.get("sourceRef") is not None else None
                ),
                "resourceId": (
                    str(payload["resourceId"]) if payload.get("resourceId") is not None else None
                ),
                "displayName": (
                    str(payload["displayName"]) if payload.get("displayName") is not None else None
                ),
                "content": content,
            }
        )
    credential_values: list[dict[str, object]] = []
    missing_credentials: list[str] = []
    for ref in fragment.credential_refs:
        credential_ref = ref.get("credentialRef")
        if not isinstance(credential_ref, str) or not credential_ref:
            continue
        value = await resolve_runtime_credential_ref(db, credential_ref)
        if value is None:
            missing_credentials.append(credential_ref)
            continue
        credential_values.append({"credentialRef": credential_ref, "value": value})
    if missing_credentials:
        raise CloudApiError(
            "runtime_config_credentials_missing",
            "Runtime config credentials are missing.",
            status_code=409,
        )
    return {
        "revision": {
            "id": fragment.revision_id,
            "sequence": fragment.sequence,
            "contentHash": fragment.content_hash,
            "externalScope": {
                "provider": "proliferate-cloud",
                "id": fragment.sandbox_profile_id,
                "targetId": fragment.target_id,
            },
        },
        "manifest": fragment.manifest,
        "artifactPayloads": artifact_payloads,
        "credentialValues": credential_values,
        "source": source,
    }


def _revision_expectation_from_apply_revision(
    revision: dict[str, object],
) -> dict[str, object]:
    revision_id = revision.get("id")
    content_hash = revision.get("contentHash")
    if not isinstance(revision_id, str) or not isinstance(content_hash, str):
        raise CloudApiError(
            "runtime_config_apply_request_invalid",
            "Runtime config apply request revision is invalid.",
            status_code=500,
        )
    sequence = revision.get("sequence")
    external_scope = revision.get("externalScope")
    return {
        "revisionId": revision_id,
        "sequence": sequence if isinstance(sequence, int) else None,
        "contentHash": content_hash,
        "externalScope": external_scope if isinstance(external_scope, dict) else None,
    }


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


def _direct_attach_auth_payload() -> dict[str, object]:
    raw_keys = settings.cloud_jwt_verification_keys_json.strip()
    if not raw_keys:
        parsed: object = []
    else:
        try:
            parsed = json.loads(raw_keys)
        except json.JSONDecodeError:
            parsed = []
    if not isinstance(parsed, list):
        parsed = []
    verification_keys: list[dict[str, object]] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        kid = item.get("kid")
        public_key_pem = item.get("publicKeyPem", item.get("public_key_pem"))
        algorithm = item.get("algorithm", "RS256")
        if (
            isinstance(kid, str)
            and kid.strip()
            and isinstance(public_key_pem, str)
            and normalize_pem_setting(public_key_pem)
            and algorithm == "RS256"
        ):
            verification_keys.append(
                {
                    "kid": kid.strip(),
                    "algorithm": "RS256",
                    "publicKeyPem": normalize_pem_setting(public_key_pem),
                }
            )
    return {
        "issuer": settings.cloud_jwt_issuer,
        "audience": settings.cloud_jwt_audience_anyharness,
        "verificationKeys": verification_keys,
    }


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
            db, profile_id=profile.id, target_id=target.id, command_id=command.id
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
    await enqueue_managed_target_wake_outbox(db, target_id=target_id, command_id=command_id)
