from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_runtime_config import artifacts as artifact_store
from proliferate.db.store.cloud_runtime_config import revisions as revision_store
from proliferate.db.store.cloud_runtime_config.revisions import (
    SandboxProfileRuntimeConfigRevisionSnapshot,
)
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_control as worker_control_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.live.service import (
    publish_worker_control_after_commit,
)
from proliferate.server.cloud.runtime_config.artifacts import (
    raise_if_artifact_integrity_invalid,
)
from proliferate.server.cloud.runtime_config.credentials import (
    credential_refs_from_manifest,
    resolve_runtime_credential_ref,
)
from proliferate.server.cloud.runtime_config.models import (
    RuntimeConfigArtifactResponse,
    RuntimeConfigCredentialValueModel,
    RuntimeConfigMaterializationFragment,
    WorkerRuntimeConfigCredentialMaterializationRequest,
    WorkerRuntimeConfigCredentialMaterializationResponse,
    WorkerRuntimeConfigStatusRequest,
    WorkerRuntimeConfigStatusResponse,
    parse_json_dict,
)
from proliferate.server.cloud.runtime_config.service import (
    runtime_config_fragment_for_revision,
)
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.server.cloud.worker.target_validation import (
    require_active_worker_target as _require_active_worker_target,
)
from proliferate.utils.crypto import decrypt_json


async def worker_runtime_config_fragment(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    revision_id: UUID,
) -> RuntimeConfigMaterializationFragment:
    await _require_active_worker_target(db, auth=auth)
    await _require_current_worker_revision(db, auth=auth, revision_id=revision_id)
    return await runtime_config_fragment_for_revision(db, revision_id=revision_id)


async def worker_runtime_config_artifact(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    revision_id: UUID,
    artifact_hash: str,
) -> RuntimeConfigArtifactResponse:
    await _require_active_worker_target(db, auth=auth)
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
    raise_if_artifact_integrity_invalid(artifact, payload=payload, content=content)
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
    await _require_active_worker_target(db, auth=auth)
    revision = await _require_current_worker_revision(db, auth=auth, revision_id=revision_id)
    manifest = parse_json_dict(revision.manifest_json) or {}
    allowed_refs = {
        str(ref["credentialRef"])
        for ref in credential_refs_from_manifest(manifest)
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
        value = await resolve_runtime_credential_ref(db, credential_ref)
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
    await _require_active_worker_target(db, auth=auth)
    revision = await _require_worker_revision(db, auth=auth, revision_id=revision_id)
    if not await _worker_revision_is_current(db, revision=revision):
        return WorkerRuntimeConfigStatusResponse(
            revision_id=str(revision.id),
            status="stale",
            updated=False,
        )
    await worker_control_store.bump_control_revision(db, target_id=auth.target_id)
    await publish_worker_control_after_commit(
        db,
        target_id=auth.target_id,
        reason="state_changed",
    )
    return WorkerRuntimeConfigStatusResponse(
        revision_id=str(revision.id),
        status=body.status,
        updated=True,
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
