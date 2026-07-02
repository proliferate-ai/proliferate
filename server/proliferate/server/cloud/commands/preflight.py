"""Cloud command preflight stamping and validation."""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudCommandKind
from proliferate.db.store.cloud_runtime_config import revisions as runtime_config_store
from proliferate.db.store.cloud_sync import target_config as target_config_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.commands.domain.payload import validate_command_payload
from proliferate.server.cloud.errors import CloudApiError


async def validate_runtime_config_preflight(
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
    raise_runtime_config_blocked_if_needed(current_revision)


async def validate_managed_runtime_config_current_for_command(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    target: targets_store.CloudTargetSnapshot,
    kind: str,
    require_target_config: bool = True,
) -> None:
    if kind not in {
        CloudCommandKind.decide_plan.value,
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
    raise_runtime_config_blocked_if_needed(current_revision)


async def stamp_managed_runtime_config_preflight(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    target: targets_store.CloudTargetSnapshot,
    kind: str,
    payload: dict[str, object],
    require_target_config: bool = True,
) -> dict[str, object]:
    del actor_user_id
    if kind not in {
        CloudCommandKind.start_session.value,
        CloudCommandKind.send_prompt.value,
        CloudCommandKind.decide_plan.value,
    }:
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
    raise_runtime_config_blocked_if_needed(current_revision)
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
    stamped = await stamp_managed_runtime_config_preflight(
        db,
        actor_user_id=actor_user_id,
        target=target,
        kind=kind,
        payload=payload,
    )
    await validate_runtime_config_preflight(
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
    payload = await stamp_managed_runtime_config_preflight(
        db,
        actor_user_id=actor_user_id,
        target=target,
        kind=kind,
        payload=payload,
    )
    validate_command_payload(kind=kind, payload=payload)
    await validate_runtime_config_preflight(
        db,
        actor_user_id=actor_user_id,
        target=target,
        payload=payload,
    )
    await validate_managed_runtime_config_current_for_command(
        db,
        actor_user_id=actor_user_id,
        target=target,
        kind=kind,
    )
    return payload


def raise_runtime_config_blocked_if_needed(
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
