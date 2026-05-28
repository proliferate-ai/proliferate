"""Application service for Proliferate Worker registration and heartbeats."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN,
    CLOUD_TARGET_HEARTBEAT_STALE_SECONDS,
    CLOUD_WORKER_TOKEN_DOMAIN,
    CloudCommandKind,
    CloudCommandStatus,
    CloudTargetStatus,
    CloudTargetUpdateStatus,
    CloudWorkerStatus,
    CloudWorkspaceCleanupState,
    CloudWorkspaceStatus,
)
from proliferate.db.store import cloud_workspaces
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_claims import tokens as claim_tokens_store
from proliferate.db.store.cloud_sandboxes import load_active_slot_for_profile_target
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import inventory as inventory_store
from proliferate.db.store.cloud_sync import projections as projections_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.db.store.users import get_user_with_oauth_accounts_by_id
from proliferate.server.cloud._logging import log_cloud_event
from proliferate.server.cloud.commands import service as command_service
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.events.models import (
    WorkerEventBatchRequest,
    WorkerEventBatchResponse,
)
from proliferate.server.cloud.events.service import ingest_worker_event_batch
from proliferate.server.cloud.live.service import (
    defer_live_publishes_until_commit,
    publish_command_status_after_commit,
    publish_target_patch_after_commit,
)
from proliferate.server.cloud.observability import log_worker_update_status
from proliferate.server.cloud.target_git_identity.service import materialize_target_git_identity
from proliferate.server.cloud.worker.domain.rules import (
    clamp_command_lease_seconds,
    compact_json,
    normalize_supported_command_kinds,
    validate_delivery_status,
    validate_result_status,
    validate_update_component,
    validate_update_status,
    validate_update_version,
    validate_worker_status,
)
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.server.cloud.worker.domain.updates import (
    ACTIVE_TARGET_UPDATE_STATUSES,
    DesiredVersions,
    desired_versions_match,
    has_desired_versions,
    require_expected_update_version,
)
from proliferate.server.cloud.worker.models import (
    WorkerCommandDeliveryRequest,
    WorkerCommandEnvelope,
    WorkerCommandLeaseRequest,
    WorkerCommandLeaseResponse,
    WorkerCommandResultRequest,
    WorkerCommandStatusResponse,
    WorkerDesiredVersionsResponse,
    WorkerEnrollRequest,
    WorkerEnrollResponse,
    WorkerExposureListResponse,
    WorkerExposureSnapshotResponse,
    WorkerHeartbeatRequest,
    WorkerHeartbeatResponse,
    WorkerInventoryPayload,
    WorkerInventoryRequest,
    WorkerInventoryResponse,
    WorkerMaterializationReportRequest,
    WorkerMaterializationReportResponse,
    WorkerProjectionGapRequest,
    WorkerProjectionGapResponse,
    WorkerRevokedJtiEntry,
    WorkerRevokedJtisResponse,
    WorkerUpdateStatusRequest,
    WorkerUpdateStatusResponse,
)
from proliferate.server.cloud.worker.slot_guard import (
    require_current_managed_worker_slot,
    target_requires_worker_slot,
)
from proliferate.utils.time import utcnow

_REVOKED_JTI_PAGE_SIZE = 500
_REVOKED_JTI_CURSOR_ZERO_ID = UUID("00000000-0000-0000-0000-000000000000")
_UNSET = object()


def _hash_token(*, domain: str, token: str) -> str:
    return hmac.new(
        settings.cloud_secret_key.encode("utf-8"),
        f"{domain}:{token}".encode(),
        hashlib.sha256,
    ).hexdigest()


async def _record_inventory_payload(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID,
    payload: WorkerInventoryPayload,
) -> None:
    await inventory_store.upsert_inventory(
        db,
        target_id=target_id,
        worker_id=worker_id,
        os=payload.os,
        arch=payload.arch,
        distro=payload.distro,
        shell=payload.shell,
        git_json=compact_json(payload.git),
        node_json=compact_json(payload.node),
        python_json=compact_json(payload.python),
        browser_json=compact_json(payload.browser),
        capabilities_json=compact_json(payload.capabilities),
        providers_json=compact_json(payload.providers),
        mcp_json=compact_json(payload.mcp),
        raw_json=None,
    )


async def _publish_current_target_patch(db: AsyncSession, *, target_id: UUID) -> None:
    target = await targets_store.get_target_by_id(db, target_id)
    if target is not None:
        await publish_target_patch_after_commit(db, target)


async def _enqueue_initial_git_identity(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID,
    created_by_user_id: UUID,
) -> None:
    user = await get_user_with_oauth_accounts_by_id(db, created_by_user_id)
    if user is None:
        await inventory_store.upsert_target_status(
            db,
            target_id=target_id,
            worker_id=worker_id,
            status_value=CloudTargetStatus.online.value,
            status_detail=(
                "Worker enrolled; Git bootstrap failed because the creator was not found."
            ),
        )
        return
    try:
        await materialize_target_git_identity(
            db,
            target_id=target_id,
            user=user,
            source="automation",
            idempotency_key="worker-enrollment",
        )
    except CloudApiError as exc:
        await inventory_store.upsert_target_status(
            db,
            target_id=target_id,
            worker_id=worker_id,
            status_value=CloudTargetStatus.online.value,
            status_detail=f"Worker enrolled; Git bootstrap failed: {exc.code}.",
        )


def _parse_json_dict(value: str | None) -> dict[str, object] | None:
    if value is None:
        return None
    parsed = json.loads(value)
    if isinstance(parsed, dict):
        return parsed
    return {"value": parsed}


def _command_envelope(
    command: commands_store.CloudCommandSnapshot,
) -> WorkerCommandEnvelope:
    payload = _parse_json_dict(command.payload_json) or {}
    return WorkerCommandEnvelope(
        command_id=str(command.id),
        idempotency_key=command.idempotency_key,
        target_id=str(command.target_id),
        workspace_id=command.workspace_id,
        cloud_workspace_id=(
            str(command.cloud_workspace_id) if command.cloud_workspace_id else None
        ),
        sandbox_profile_id=_sandbox_profile_id_from_payload(command.payload_json),
        slot_generation=command.leased_slot_generation,
        session_id=command.session_id,
        kind=command.kind,
        payload=_worker_delivery_payload(command, payload),
        observed_event_seq=command.observed_event_seq,
        preconditions=_parse_json_dict(command.preconditions_json),
        lease_id=command.lease_id or "",
        lease_expires_at=command.lease_expires_at.isoformat() if command.lease_expires_at else "",
    )


def _sandbox_profile_id_from_payload(payload_json: str) -> str | None:
    value = _parse_json_dict(payload_json) or {}
    sandbox_profile_id = value.get("sandboxProfileId")
    return sandbox_profile_id if isinstance(sandbox_profile_id, str) else None


def _worker_delivery_payload(
    command: commands_store.CloudCommandSnapshot,
    payload: dict[str, object],
) -> dict[str, object]:
    if command.kind == CloudCommandKind.start_session.value:
        sanitized = dict(payload)
        _ensure_expected_runtime_config_revision(
            sanitized,
            target_id=str(command.target_id),
        )
        _strip_cloud_launch_preflight_fields(sanitized)
        return sanitized
    if command.kind == CloudCommandKind.send_prompt.value:
        sanitized = dict(payload)
        _strip_cloud_launch_preflight_fields(sanitized)
        sanitized.pop("agentAuthScope", None)
        sanitized.pop("requiredAgentAuthRevision", None)
        return sanitized
    return payload


def _ensure_expected_runtime_config_revision(
    payload: dict[str, object],
    *,
    target_id: str,
) -> None:
    if isinstance(payload.get("expectedRuntimeConfigRevision"), dict):
        return
    sandbox_profile_id = payload.get("sandboxProfileId")
    revision_id = payload.get("requiredRuntimeConfigRevisionId")
    sequence = payload.get("requiredRuntimeConfigSequence")
    content_hash = payload.get("requiredRuntimeConfigContentHash")
    if not (
        isinstance(sandbox_profile_id, str)
        and isinstance(revision_id, str)
        and isinstance(sequence, int)
        and not isinstance(sequence, bool)
        and isinstance(content_hash, str)
    ):
        return
    payload["expectedRuntimeConfigRevision"] = {
        "revisionId": revision_id,
        "sequence": sequence,
        "contentHash": content_hash,
        "externalScope": {
            "provider": "proliferate-cloud",
            "id": sandbox_profile_id,
            "targetId": target_id,
        },
    }


def _strip_cloud_launch_preflight_fields(payload: dict[str, object]) -> None:
    payload.pop("sandboxProfileId", None)
    payload.pop("requiredRuntimeConfigRevisionId", None)
    payload.pop("requiredRuntimeConfigSequence", None)
    payload.pop("requiredRuntimeConfigContentHash", None)


def _target_desired_versions(target: targets_store.CloudTargetSnapshot) -> DesiredVersions:
    return DesiredVersions(
        anyharness_version=target.desired_anyharness_version,
        worker_version=target.desired_worker_version,
        supervisor_version=target.desired_supervisor_version,
    )


def _worker_current_versions(worker: worker_auth_store.CloudWorkerSnapshot) -> DesiredVersions:
    return DesiredVersions(
        anyharness_version=worker.anyharness_version,
        worker_version=worker.worker_version,
        supervisor_version=worker.supervisor_version,
    )


def _target_current_versions(
    target: targets_store.CloudTargetSnapshot,
) -> DesiredVersions | None:
    current_versions = target.current_versions
    if current_versions is None:
        return None
    return DesiredVersions(
        anyharness_version=current_versions.anyharness_version,
        worker_version=current_versions.worker_version,
        supervisor_version=current_versions.supervisor_version,
    )


def _target_has_desired_versions(target: targets_store.CloudTargetSnapshot) -> bool:
    return has_desired_versions(_target_desired_versions(target))


def _desired_versions_response(
    *,
    target: targets_store.CloudTargetSnapshot,
    worker: worker_auth_store.CloudWorkerSnapshot,
) -> WorkerDesiredVersionsResponse:
    desired = _target_desired_versions(target)
    current = _worker_current_versions(worker)
    should_update = has_desired_versions(desired) and not desired_versions_match(
        desired=desired,
        current=current,
    )
    return WorkerDesiredVersionsResponse(
        should_update=should_update,
        update_channel=target.update_channel,
        update_generation=target.update_generation,
        anyharness_version=target.desired_anyharness_version,
        worker_version=target.desired_worker_version,
        supervisor_version=target.desired_supervisor_version,
    )


def _require_worker_slot_identity(
    *,
    auth: WorkerAuthContext,
    body: WorkerHeartbeatRequest,
    target: targets_store.CloudTargetSnapshot,
) -> None:
    target_requires_slot = target_requires_worker_slot(target)
    if not target_requires_slot and auth.cloud_sandbox_id is None and auth.slot_generation is None:
        return
    if auth.cloud_sandbox_id is None or auth.slot_generation is None:
        raise CloudApiError(
            "cloud_worker_slot_identity_required",
            "Managed cloud worker is missing sandbox slot identity.",
            status_code=409,
        )
    if target_requires_slot:
        reported_profile_id = _optional_uuid(
            body.sandbox_profile_id,
            field_name="sandboxProfileId",
        )
        if reported_profile_id is None or reported_profile_id != target.sandbox_profile_id:
            raise CloudApiError(
                "cloud_worker_slot_identity_required",
                "Managed cloud worker heartbeat must include sandboxProfileId.",
                status_code=409,
            )
    try:
        reported_sandbox_id = UUID(body.cloud_sandbox_id or "")
    except ValueError as exc:
        raise CloudApiError(
            "cloud_worker_slot_identity_required",
            "Managed cloud worker heartbeat must include cloudSandboxId.",
            status_code=409,
        ) from exc
    if (
        reported_sandbox_id != auth.cloud_sandbox_id
        or body.slot_generation != auth.slot_generation
    ):
        raise CloudApiError(
            "cloud_worker_slot_stale",
            "Worker slot identity does not match enrollment.",
            status_code=409,
        )


async def _require_enrollment_slot_for_target(
    db: AsyncSession,
    *,
    enrollment: worker_auth_store.CloudTargetEnrollmentSnapshot,
    target: targets_store.CloudTargetSnapshot,
) -> None:
    if not target_requires_worker_slot(target):
        return
    if (
        target.sandbox_profile_id is None
        or enrollment.sandbox_profile_id != target.sandbox_profile_id
        or enrollment.cloud_sandbox_id is None
        or enrollment.slot_generation is None
    ):
        raise CloudApiError(
            "cloud_worker_slot_identity_required",
            "Managed cloud worker enrollment requires sandbox slot identity.",
            status_code=409,
        )
    active_slot = await load_active_slot_for_profile_target(
        db,
        sandbox_profile_id=target.sandbox_profile_id,
        target_id=target.id,
    )
    if (
        active_slot is None
        or active_slot.id != enrollment.cloud_sandbox_id
        or active_slot.slot_generation != enrollment.slot_generation
    ):
        raise CloudApiError(
            "cloud_worker_slot_stale",
            "Enrollment sandbox slot is no longer active.",
            status_code=409,
        )


def _optional_uuid(value: str | None, *, field_name: str) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(value)
    except ValueError as exc:
        raise CloudApiError(
            "cloud_worker_invalid_uuid",
            f"{field_name} must be a UUID.",
            status_code=400,
        ) from exc


async def enroll_worker(
    db: AsyncSession,
    *,
    body: WorkerEnrollRequest,
) -> WorkerEnrollResponse:
    now = utcnow()
    enrollment = await worker_auth_store.consume_pending_enrollment_by_hash(
        db,
        token_hash=_hash_token(
            domain=CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN,
            token=body.enrollment_token,
        ),
        now=now,
    )
    if enrollment is None:
        raise CloudApiError(
            "cloud_worker_enrollment_invalid",
            "Enrollment token is invalid or expired.",
            status_code=401,
        )
    target = await targets_store.get_target_by_id(db, enrollment.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    await _require_enrollment_slot_for_target(db, enrollment=enrollment, target=target)
    worker_token = secrets.token_urlsafe(48)
    worker = await worker_auth_store.create_worker(
        db,
        target_id=enrollment.target_id,
        cloud_sandbox_id=enrollment.cloud_sandbox_id,
        slot_generation=enrollment.slot_generation,
        token_hash=_hash_token(domain=CLOUD_WORKER_TOKEN_DOMAIN, token=worker_token),
        machine_fingerprint=body.machine_fingerprint,
        hostname=body.hostname,
        worker_version=body.worker_version,
        anyharness_version=body.anyharness_version,
        supervisor_version=body.supervisor_version,
        now=now,
    )
    await inventory_store.upsert_target_status(
        db,
        target_id=worker.target_id,
        worker_id=worker.id,
        status_value=CloudTargetStatus.online.value,
        status_detail="Worker enrolled.",
    )
    await targets_store.set_target_status(
        db,
        target_id=worker.target_id,
        status_value=CloudTargetStatus.online.value,
    )
    if (
        enrollment.sandbox_profile_id is not None
        and worker.cloud_sandbox_id is not None
        and worker.slot_generation is not None
    ):
        await _update_runtime_access_for_managed_worker(
            db,
            target_id=worker.target_id,
            sandbox_profile_id=enrollment.sandbox_profile_id,
            cloud_sandbox_id=worker.cloud_sandbox_id,
            slot_generation=worker.slot_generation,
            worker_id=worker.id,
            now=now,
        )
    if body.inventory is not None:
        await _record_inventory_payload(
            db,
            target_id=worker.target_id,
            worker_id=worker.id,
            payload=body.inventory,
        )
    await _enqueue_initial_git_identity(
        db,
        target_id=worker.target_id,
        worker_id=worker.id,
        created_by_user_id=enrollment.created_by_user_id,
    )
    await _publish_current_target_patch(db, target_id=worker.target_id)
    return WorkerEnrollResponse(
        target_id=str(worker.target_id),
        sandbox_profile_id=(
            str(enrollment.sandbox_profile_id) if enrollment.sandbox_profile_id else None
        ),
        cloud_sandbox_id=str(worker.cloud_sandbox_id) if worker.cloud_sandbox_id else None,
        slot_generation=worker.slot_generation,
        worker_id=str(worker.id),
        worker_token=worker_token,
        heartbeat_interval_seconds=CLOUD_TARGET_HEARTBEAT_STALE_SECONDS // 3,
    )


async def authenticate_worker(
    db: AsyncSession,
    *,
    authorization: str | None,
) -> WorkerAuthContext:
    if authorization is None or not authorization.startswith("Bearer "):
        raise CloudApiError(
            "cloud_worker_auth_required",
            "Worker authentication is required.",
            status_code=401,
        )
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise CloudApiError(
            "cloud_worker_auth_required",
            "Worker authentication is required.",
            status_code=401,
        )
    worker = await worker_auth_store.get_worker_by_token_hash(
        db,
        token_hash=_hash_token(domain=CLOUD_WORKER_TOKEN_DOMAIN, token=token),
    )
    if worker is None:
        raise CloudApiError(
            "cloud_worker_auth_invalid",
            "Worker token is invalid.",
            status_code=401,
        )
    if worker.status == CloudWorkerStatus.archived.value:
        raise CloudApiError(
            "cloud_worker_archived",
            "Worker token is archived.",
            status_code=401,
        )
    target = await targets_store.get_target_by_id(db, worker.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    if target.status == CloudTargetStatus.archived.value:
        raise CloudApiError(
            "cloud_worker_target_archived",
            "Worker target is archived.",
            status_code=409,
        )
    return WorkerAuthContext(
        worker_id=worker.id,
        target_id=worker.target_id,
        cloud_sandbox_id=worker.cloud_sandbox_id,
        slot_generation=worker.slot_generation,
    )


async def list_revoked_jtis(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    cursor: str | None,
) -> WorkerRevokedJtisResponse:
    after_revoked_at, after_token_id = _parse_revoked_jti_cursor(cursor)
    until = utcnow()
    rows = await claim_tokens_store.list_revoked_token_hashes_for_target_window(
        db,
        target_id=auth.target_id,
        after_revoked_at=after_revoked_at,
        after_token_id=after_token_id,
        until_revoked_at=until,
        limit=_REVOKED_JTI_PAGE_SIZE + 1,
    )
    has_more = len(rows) > _REVOKED_JTI_PAGE_SIZE
    tokens = rows[:_REVOKED_JTI_PAGE_SIZE]
    next_cursor = (
        _revoked_jti_cursor(tokens[-1].revoked_at, tokens[-1].id)
        if tokens and tokens[-1].revoked_at is not None
        else (cursor.strip() if cursor else "")
    )
    return WorkerRevokedJtisResponse(
        revoked_jtis=[
            WorkerRevokedJtiEntry(
                jti_hash=token.token_jti_hash,
                hash_key_id=token.hash_key_id,
                expires_at=token.expires_at.isoformat(),
                revoked_at=token.revoked_at.isoformat() if token.revoked_at else "",
            )
            for token in tokens
            if token.revoked_at is not None
        ],
        server_time=until.isoformat(),
        next_cursor=next_cursor,
        has_more=has_more,
    )


def _parse_revoked_jti_cursor(cursor: str | None) -> tuple[datetime | None, UUID | None]:
    if cursor is None or not cursor.strip():
        return None, None
    raw_timestamp, separator, raw_id = cursor.partition("|")
    try:
        revoked_at = datetime.fromisoformat(raw_timestamp)
    except ValueError:
        return None, None
    if not separator:
        return revoked_at, _REVOKED_JTI_CURSOR_ZERO_ID
    try:
        token_id = UUID(raw_id)
    except ValueError:
        token_id = _REVOKED_JTI_CURSOR_ZERO_ID
    return revoked_at, token_id


def _revoked_jti_cursor(revoked_at: datetime, token_id: UUID) -> str:
    return f"{revoked_at.isoformat()}|{token_id}"


async def record_heartbeat(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerHeartbeatRequest,
) -> WorkerHeartbeatResponse:
    status_value = validate_worker_status(body.status)
    now = utcnow()
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    _require_worker_slot_identity(auth=auth, body=body, target=target)
    await require_current_managed_worker_slot(db, auth=auth, target=target)
    worker = await worker_auth_store.record_worker_heartbeat(
        db,
        worker_id=auth.worker_id,
        status_value=status_value,
        worker_version=body.worker_version,
        anyharness_version=body.anyharness_version,
        supervisor_version=body.supervisor_version,
        now=now,
    )
    if worker is None:
        raise CloudApiError(
            "cloud_worker_not_found",
            "Worker not found.",
            status_code=404,
        )
    await inventory_store.upsert_target_status(
        db,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        status_value=status_value,
        status_detail=body.status_detail,
    )
    await targets_store.set_target_status(db, target_id=auth.target_id, status_value=status_value)
    if target_requires_worker_slot(target):
        assert auth.cloud_sandbox_id is not None
        assert auth.slot_generation is not None
        sandbox_profile_id = _optional_uuid(
            body.sandbox_profile_id,
            field_name="sandboxProfileId",
        )
        if sandbox_profile_id is None or target.sandbox_profile_id != sandbox_profile_id:
            raise CloudApiError(
                "cloud_worker_slot_identity_required",
                "Managed cloud worker heartbeat must include sandboxProfileId.",
                status_code=409,
            )
        await _update_runtime_access_for_managed_worker(
            db,
            target_id=auth.target_id,
            sandbox_profile_id=sandbox_profile_id,
            cloud_sandbox_id=auth.cloud_sandbox_id,
            slot_generation=auth.slot_generation,
            worker_id=auth.worker_id,
            now=now,
        )
    desired_versions = _desired_versions_response(target=target, worker=worker)
    if target.update_status in ACTIVE_TARGET_UPDATE_STATUSES and desired_versions_match(
        desired=_target_desired_versions(target),
        current=_worker_current_versions(worker),
    ):
        result = await targets_store.record_target_update_status_for_generation(
            db,
            target_id=auth.target_id,
            expected_update_generation=target.update_generation,
            status_value=CloudTargetUpdateStatus.applied.value,
            status_detail="Desired versions reported by worker.",
            component=None,
            version=None,
            reported_at=now,
        )
        target = result.target or target
    await publish_target_patch_after_commit(db, target)
    return WorkerHeartbeatResponse(
        target_id=str(auth.target_id),
        sandbox_profile_id=body.sandbox_profile_id,
        cloud_sandbox_id=str(auth.cloud_sandbox_id) if auth.cloud_sandbox_id else None,
        slot_generation=auth.slot_generation,
        worker_id=str(auth.worker_id),
        status=status_value,
        server_time=now.isoformat(),
        desired_versions=desired_versions,
    )


async def _update_runtime_access_for_managed_worker(
    db: AsyncSession,
    *,
    target_id: UUID,
    sandbox_profile_id: UUID,
    cloud_sandbox_id: UUID,
    slot_generation: int,
    worker_id: UUID,
    now: datetime,
) -> None:
    runtime_access = await targets_store.update_target_runtime_access(
        db,
        target_id=target_id,
        sandbox_profile_id=sandbox_profile_id,
        active_sandbox_id=cloud_sandbox_id,
        slot_generation=slot_generation,
        anyharness_base_url=None,
        runtime_token_ciphertext=None,
        anyharness_data_key_ciphertext=None,
        worker_id=worker_id,
        heartbeat_at=now,
    )
    if runtime_access is None:
        raise CloudApiError(
            "cloud_worker_slot_stale",
            "Worker slot identity is no longer the active sandbox slot.",
            status_code=409,
        )


async def record_inventory(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerInventoryRequest,
) -> WorkerInventoryResponse:
    status_value = validate_worker_status(body.status)
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    await require_current_managed_worker_slot(db, auth=auth, target=target)
    await _record_inventory_payload(
        db,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        payload=body,
    )
    await inventory_store.upsert_target_status(
        db,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        status_value=status_value,
        status_detail=body.status_detail,
    )
    await targets_store.set_target_status(db, target_id=auth.target_id, status_value=status_value)
    await _publish_current_target_patch(db, target_id=auth.target_id)
    return WorkerInventoryResponse(
        target_id=str(auth.target_id),
        worker_id=str(auth.worker_id),
        updated=True,
    )


def _report_cleanup_state(
    body: WorkerMaterializationReportRequest,
) -> str | object:
    cleanup_status = (body.cleanup_status or "").strip().lower()
    state = body.state.strip().lower()
    if cleanup_status in {"completed", "complete"}:
        return CloudWorkspaceCleanupState.complete.value
    if cleanup_status == "blocked" or state == "prune_blocked":
        return CloudWorkspaceCleanupState.blocked.value
    if cleanup_status == "failed" or state == "prune_failed":
        return CloudWorkspaceCleanupState.failed.value
    if cleanup_status in {"pruning", "pending"} or state in {"dehydrating", "pruning"}:
        return CloudWorkspaceCleanupState.pending.value
    if state == "hydrated":
        return CloudWorkspaceCleanupState.none.value
    return _UNSET


def _report_cleanup_error(body: WorkerMaterializationReportRequest) -> str | None | object:
    if body.cleanup_last_error:
        return body.cleanup_last_error
    if body.blockers:
        return json.dumps({"blockers": body.blockers}, separators=(",", ":"), sort_keys=True)
    return None if (body.cleanup_status or "").lower() in {"completed", "complete"} else _UNSET


async def record_materialization_report(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerMaterializationReportRequest,
) -> WorkerMaterializationReportResponse:
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    await require_current_managed_worker_slot(db, auth=auth, target=target)
    workspace = await cloud_workspaces.get_cloud_workspace_by_id(
        db,
        body.cloud_workspace_id,
    )
    if workspace is None:
        raise CloudApiError(
            "cloud_worker_workspace_missing",
            "Cloud workspace no longer exists.",
            status_code=404,
        )
    if workspace.target_id != auth.target_id:
        raise CloudApiError(
            "cloud_worker_workspace_target_mismatch",
            "Cloud workspace is not attached to this worker target.",
            status_code=409,
        )

    state = body.state.strip().lower()
    status: str | object = _UNSET
    status_detail: str | None | object = _UNSET
    anyharness_workspace_id: str | None | object = _UNSET
    cleanup_state = _report_cleanup_state(body)
    cleanup_last_error = _report_cleanup_error(body)

    if state == "hydrated":
        if not body.anyharness_workspace_id:
            raise CloudApiError(
                "cloud_worker_materialization_workspace_required",
                "Hydrated materialization reports require anyharnessWorkspaceId.",
                status_code=400,
            )
        anyharness_workspace_id = body.anyharness_workspace_id
        status = (
            CloudWorkspaceStatus.archived.value
            if workspace.archived_at is not None
            else CloudWorkspaceStatus.ready.value
        )
        status_detail = "Archived" if workspace.archived_at is not None else "Ready"
    elif state in {"dehydrated", "prune_blocked", "prune_failed", "dehydrating", "pruning"}:
        if (
            body.anyharness_workspace_id
            and workspace.anyharness_workspace_id is not None
            and workspace.anyharness_workspace_id != body.anyharness_workspace_id
        ):
            raise CloudApiError(
                "cloud_worker_materialization_workspace_mismatch",
                "Materialization report does not match the current AnyHarness workspace.",
                status_code=409,
            )
        if body.anyharness_workspace_id:
            anyharness_workspace_id = None if state == "dehydrated" else _UNSET
        status = (
            CloudWorkspaceStatus.archived.value
            if workspace.archived_at is not None
            else CloudWorkspaceStatus.needs_rematerialization.value
            if state == "dehydrated"
            else _UNSET
        )
        status_detail = (
            "Archived"
            if workspace.archived_at is not None
            else "Worktree pruned"
            if state == "dehydrated"
            else _UNSET
        )
    else:
        raise CloudApiError(
            "cloud_worker_materialization_state_invalid",
            f"Unsupported materialization state: {body.state}",
            status_code=400,
        )

    updates: dict[str, object] = {}
    if anyharness_workspace_id is not _UNSET:
        updates["anyharness_workspace_id"] = anyharness_workspace_id
    if state == "dehydrated":
        updates["worktree_path"] = None
    elif body.worktree_path is not None:
        updates["worktree_path"] = body.worktree_path
    if status is not _UNSET:
        updates["status"] = status
    if status_detail is not _UNSET:
        updates["status_detail"] = status_detail
    if cleanup_state is not _UNSET:
        updates["cleanup_state"] = cleanup_state
    if cleanup_last_error is not _UNSET:
        updates["cleanup_last_error"] = cleanup_last_error
    if state == "hydrated" and auth.slot_generation is not None:
        updates["materialized_slot_generation"] = auth.slot_generation
    await cloud_workspaces.update_cloud_workspace_materialization_state(
        db,
        workspace=workspace,
        **updates,
    )
    if state == "dehydrated" and body.anyharness_workspace_id:
        await exposures_store.clear_workspace_exposure_materialization(
            db,
            target_id=auth.target_id,
            cloud_workspace_id=workspace.id,
            anyharness_workspace_id=body.anyharness_workspace_id,
        )
    await db.commit()
    return WorkerMaterializationReportResponse(
        cloud_workspace_id=str(workspace.id),
        updated=True,
    )


async def record_update_status(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerUpdateStatusRequest,
) -> WorkerUpdateStatusResponse:
    status_value = validate_update_status(body.status)
    component = validate_update_component(body.component)
    version = validate_update_version(body.version)
    detail = body.detail or body.error_message
    current_target = await targets_store.get_target_by_id(db, auth.target_id)
    if current_target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    await require_current_managed_worker_slot(db, auth=auth, target=current_target)
    if not _target_has_desired_versions(current_target):
        raise CloudApiError(
            "cloud_worker_update_not_requested",
            "Worker update status cannot be reported before desired versions are set.",
            status_code=409,
        )
    require_expected_update_version(
        desired=_target_desired_versions(current_target),
        current_update_generation=current_target.update_generation,
        update_generation=body.update_generation,
        status_value=status_value,
        component=component,
        version=version,
    )
    if status_value == CloudTargetUpdateStatus.applied.value and not (
        desired_versions_match(
            desired=_target_desired_versions(current_target),
            current=_target_current_versions(current_target),
        )
    ):
        raise CloudApiError(
            "cloud_worker_update_versions_not_current",
            "Worker update cannot be marked applied until current versions "
            "match desired versions.",
            status_code=409,
        )
    result = await targets_store.record_target_update_status_for_generation(
        db,
        target_id=auth.target_id,
        expected_update_generation=current_target.update_generation,
        status_value=status_value,
        status_detail=detail,
        component=component,
        version=version,
        reported_at=utcnow(),
    )
    if not result.generation_matched:
        raise CloudApiError(
            "cloud_worker_update_generation_stale",
            "Worker update generation does not match the target desired versions.",
            status_code=409,
        )
    if result.target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    target = result.target
    log_worker_update_status(
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        status=status_value,
        component=component,
        version=version,
    )
    await publish_target_patch_after_commit(db, target)
    return WorkerUpdateStatusResponse(
        target_id=str(auth.target_id),
        worker_id=str(auth.worker_id),
        updated=True,
    )


async def lease_worker_command(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerCommandLeaseRequest,
) -> WorkerCommandLeaseResponse:
    supported_kinds = normalize_supported_command_kinds(body.supported_kinds)
    lease_seconds = clamp_command_lease_seconds(body.lease_timeout_seconds)
    now = utcnow()
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    await require_current_managed_worker_slot(db, auth=auth, target=target)
    expired_commands = await command_service.expire_stale_client_commands_for_target(
        db,
        target_id=auth.target_id,
    )
    command = await commands_store.lease_next_command(
        db,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        supported_kinds=supported_kinds,
        lease_id=secrets.token_urlsafe(24),
        lease_expires_at=now + timedelta(seconds=lease_seconds),
        now=now,
    )
    if command is not None:
        log_cloud_event(
            "cloud worker command leased",
            command_id=command.id,
            target_id=auth.target_id,
            worker_id=auth.worker_id,
            kind=command.kind,
            workspace_id=command.workspace_id,
            session_id=command.session_id,
            cloud_workspace_id=command.cloud_workspace_id,
            attempt_count=command.attempt_count,
            lease_expires_at=command.lease_expires_at,
        )
        await publish_command_status_after_commit(db, command)
        # Workers report delivery immediately after receiving a lease. The lease
        # must be committed before the HTTP response is returned, otherwise the
        # delivery request can race the request-session commit and fail closed as
        # "not leased by this worker."
    if command is not None or expired_commands:
        await db.commit()
    return WorkerCommandLeaseResponse(
        command=_command_envelope(command) if command is not None else None,
        server_time=now.isoformat(),
    )


async def record_command_delivery(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    command_id: UUID,
    body: WorkerCommandDeliveryRequest,
) -> WorkerCommandStatusResponse:
    status = validate_delivery_status(body.status)
    now = utcnow()
    if status == CloudCommandStatus.failed_delivery.value:
        command = await commands_store.mark_command_failed_delivery(
            db,
            command_id=command_id,
            worker_id=auth.worker_id,
            lease_id=body.lease_id,
            slot_generation=body.slot_generation,
            error_code=body.error_code,
            error_message=body.error_message,
            now=now,
        )
    else:
        command = await commands_store.mark_command_delivered(
            db,
            command_id=command_id,
            worker_id=auth.worker_id,
            lease_id=body.lease_id,
            slot_generation=body.slot_generation,
            now=now,
        )
    if command is None:
        raise CloudApiError(
            "cloud_worker_command_not_leased",
            "Command is not leased by this worker.",
            status_code=404,
        )
    log_cloud_event(
        "cloud worker command delivery recorded",
        command_id=command.id,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        kind=command.kind,
        status=command.status,
        error_code=command.error_code,
        workspace_id=command.workspace_id,
        session_id=command.session_id,
        cloud_workspace_id=command.cloud_workspace_id,
    )
    if _command_result_should_fail_pending_prompt(command):
        await command_service.mark_pending_prompt_interaction_failed_for_command(db, command)
    await publish_command_status_after_commit(db, command)
    return WorkerCommandStatusResponse(
        command_id=str(command.id),
        status=command.status,
        updated=True,
    )


async def _record_agent_auth_state_from_command_result(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    command: commands_store.CloudCommandSnapshot,
    body: WorkerCommandResultRequest,
    status: str,
) -> None:
    """Accept refresh command results as a compatibility materialization signal.

    New workers report the detailed status endpoint during materialization.
    Older deployed worker bundles may only return an accepted command result;
    the command result is still slot-fenced and worker-authenticated, so it is
    sufficient to mark the target current for the reported revision.
    """

    if command.kind != CloudCommandKind.refresh_agent_auth_config.value:
        return
    if status not in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
    }:
        return
    try:
        payload = json.loads(command.payload_json or "{}")
    except ValueError:
        return
    if not isinstance(payload, dict):
        return
    try:
        sandbox_profile_id = UUID(str(payload.get("sandboxProfileId") or ""))
        revision = int(payload.get("revision"))
    except (TypeError, ValueError):
        return
    result = body.result or {}
    if not isinstance(result, dict):
        return
    current_revision = _optional_int_result_field(result.get("currentRevision"))
    existing = await agent_auth_store.get_target_state(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=auth.target_id,
    )
    if existing is not None and existing.desired_revision > revision:
        return
    if (
        existing is not None
        and existing.last_command_id is not None
        and existing.last_command_id != command.id
        and existing.desired_revision >= revision
    ):
        return
    applied_revision = existing.applied_revision if existing is not None else None
    desired_revision = max(revision, current_revision or revision)
    state_status = "superseded"
    if result.get("applied") is True and desired_revision <= revision:
        applied_revision = revision
        desired_revision = revision
        state_status = "applied"
    elif current_revision is None and result.get("reason") != "superseded":
        return
    force_restart_required = existing.force_restart_required if existing is not None else False
    if state_status == "applied":
        force_restart_required = False
    await agent_auth_store.upsert_target_state(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=auth.target_id,
        desired_revision=desired_revision,
        applied_revision=applied_revision,
        status=state_status,
        force_restart_required=force_restart_required,
        last_command_id=command.id,
        last_worker_id=auth.worker_id,
        last_error_code=None,
        last_error_message=None,
    )


def _optional_int_result_field(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


async def record_command_result(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    command_id: UUID,
    body: WorkerCommandResultRequest,
) -> WorkerCommandStatusResponse:
    status = validate_result_status(body.status)
    command = await commands_store.record_command_result(
        db,
        command_id=command_id,
        worker_id=auth.worker_id,
        lease_id=body.lease_id,
        status=status,
        error_code=body.error_code,
        error_message=body.error_message,
        result_json=compact_json(body.result),
        cloud_workspace_id=_optional_uuid(
            body.cloud_workspace_id,
            field_name="cloudWorkspaceId",
        ),
        slot_generation=body.slot_generation,
        anyharness_workspace_id=body.anyharness_workspace_id,
        now=utcnow(),
    )
    if command is None:
        raise CloudApiError(
            "cloud_worker_command_not_leased",
            "Command is not leased by this worker.",
            status_code=404,
        )
    log_cloud_event(
        "cloud worker command result recorded",
        command_id=command.id,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        kind=command.kind,
        status=command.status,
        error_code=command.error_code,
        workspace_id=command.workspace_id,
        session_id=command.session_id,
        cloud_workspace_id=command.cloud_workspace_id,
    )
    await _record_agent_auth_state_from_command_result(
        db,
        auth=auth,
        command=command,
        body=body,
        status=command.status,
    )
    if _command_result_should_fail_pending_prompt(command):
        await command_service.mark_pending_prompt_interaction_failed_for_command(db, command)
    await publish_command_status_after_commit(db, command)
    return WorkerCommandStatusResponse(
        command_id=str(command.id),
        status=command.status,
        updated=True,
    )


def _command_result_should_fail_pending_prompt(
    command: commands_store.CloudCommandSnapshot,
) -> bool:
    return command.kind == CloudCommandKind.send_prompt.value and command.status in {
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.failed_delivery.value,
        CloudCommandStatus.superseded.value,
    }


async def list_worker_exposures(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
) -> WorkerExposureListResponse:
    exposures = await exposures_store.list_active_workspace_exposures_for_target(
        db,
        target_id=auth.target_id,
    )
    cursors = await projections_store.list_active_projection_cursors_for_target(
        db,
        target_id=auth.target_id,
    )
    responses: list[WorkerExposureSnapshotResponse] = []
    for cursor in cursors:
        workspace = await cloud_workspaces.get_cloud_workspace_by_id(
            db,
            cursor.cloud_workspace_id,
        )
        if workspace is None or workspace.archived_at is not None:
            continue
        responses.append(
            WorkerExposureSnapshotResponse(
                exposure_id=str(cursor.exposure_id),
                target_id=str(cursor.target_id),
                cloud_workspace_id=str(cursor.cloud_workspace_id),
                session_projection_id=str(cursor.session_projection_id),
                anyharness_workspace_id=cursor.anyharness_workspace_id,
                anyharness_session_id=cursor.anyharness_session_id,
                projection_level=cursor.projection_level,
                commandable=cursor.commandable,
                status=cursor.exposure_status,
                revision=cursor.exposure_revision,
                last_uploaded_seq=cursor.last_uploaded_seq,
            )
        )
    for exposure in exposures:
        if not exposure.anyharness_workspace_id:
            continue
        workspace = await cloud_workspaces.get_cloud_workspace_by_id(
            db,
            exposure.cloud_workspace_id,
        )
        if workspace is None or workspace.archived_at is not None:
            continue
        responses.append(
            WorkerExposureSnapshotResponse(
                exposure_id=str(exposure.id),
                target_id=str(exposure.target_id),
                cloud_workspace_id=str(exposure.cloud_workspace_id),
                session_projection_id=None,
                anyharness_workspace_id=exposure.anyharness_workspace_id,
                anyharness_session_id=None,
                projection_level=exposure.default_projection_level,
                commandable=exposure.commandable,
                status=exposure.status,
                revision=exposure.revision,
                last_uploaded_seq=0,
            )
        )
    return WorkerExposureListResponse(exposures=responses)


async def record_event_batch(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerEventBatchRequest,
) -> WorkerEventBatchResponse:
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    await require_current_managed_worker_slot(db, auth=auth, target=target)
    with defer_live_publishes_until_commit(db):
        return await ingest_worker_event_batch(db, auth=auth, body=body)


async def record_projection_gap(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerProjectionGapRequest,
) -> WorkerProjectionGapResponse:
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    await require_current_managed_worker_slot(db, auth=auth, target=target)
    projection = await projections_store.get_session_projection_metadata(
        db,
        target_id=auth.target_id,
        session_id=body.session_id,
    )
    if (
        projection is None
        or projection.id != body.session_projection_id
        or projection.exposure_id != body.exposure_id
    ):
        raise CloudApiError(
            "cloud_projection_gap_projection_mismatch",
            "Projection gap does not match an active Cloud projection.",
            status_code=409,
        )
    exposure = await exposures_store.get_workspace_exposure_by_id(db, body.exposure_id)
    if exposure is None or exposure.archived_at is not None or exposure.status != "active":
        raise CloudApiError(
            "cloud_projection_gap_exposure_inactive",
            "Projection exposure is no longer active.",
            status_code=409,
        )
    if (projection.last_uploaded_seq or 0) > body.last_uploaded_seq or (
        projection.last_uploaded_seq or 0
    ) >= body.expected_seq:
        return WorkerProjectionGapResponse(updated=False)
    gap_state_json = compact_json(
        {
            "reason": "anyharness_event_sequence_gap",
            "expectedSeq": body.expected_seq,
            "firstObservedSeq": body.first_observed_seq,
            "lastUploadedSeq": body.last_uploaded_seq,
            "exposureId": str(body.exposure_id),
            "sessionProjectionId": str(body.session_projection_id),
            "reportedByWorkerId": str(auth.worker_id),
            "reportedAt": utcnow().isoformat(),
        }
    )
    await projections_store.set_projection_gap_state(
        db,
        target_id=auth.target_id,
        session_id=body.session_id,
        gap_state_json=gap_state_json or "{}",
    )
    return WorkerProjectionGapResponse(updated=True)
