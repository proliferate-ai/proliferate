"""Application service for Proliferate Worker registration and heartbeats."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN,
    CLOUD_TARGET_HEARTBEAT_STALE_SECONDS,
    CLOUD_WORKER_TOKEN_DOMAIN,
    CloudCommandStatus,
    CloudTargetStatus,
    CloudTargetUpdateStatus,
    CloudWorkerStatus,
)
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import inventory as inventory_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
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
    WorkerHeartbeatRequest,
    WorkerHeartbeatResponse,
    WorkerInventoryPayload,
    WorkerInventoryRequest,
    WorkerInventoryResponse,
    WorkerUpdateStatusRequest,
    WorkerUpdateStatusResponse,
)
from proliferate.utils.time import utcnow

_ACTIVE_TARGET_UPDATE_STATUSES = frozenset(
    {
        CloudTargetUpdateStatus.staging.value,
        CloudTargetUpdateStatus.staged.value,
        CloudTargetUpdateStatus.applying.value,
    }
)


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
    return WorkerCommandEnvelope(
        command_id=str(command.id),
        idempotency_key=command.idempotency_key,
        target_id=str(command.target_id),
        workspace_id=command.workspace_id,
        session_id=command.session_id,
        kind=command.kind,
        payload=_parse_json_dict(command.payload_json) or {},
        observed_event_seq=command.observed_event_seq,
        preconditions=_parse_json_dict(command.preconditions_json),
        lease_id=command.lease_id or "",
        lease_expires_at=command.lease_expires_at.isoformat() if command.lease_expires_at else "",
    )


def _desired_versions_response(
    *,
    target: targets_store.CloudTargetSnapshot,
    worker: worker_auth_store.CloudWorkerSnapshot,
) -> WorkerDesiredVersionsResponse:
    should_update = any(
        (
            target.desired_anyharness_version is not None
            and target.desired_anyharness_version != worker.anyharness_version,
            target.desired_worker_version is not None
            and target.desired_worker_version != worker.worker_version,
            target.desired_supervisor_version is not None
            and target.desired_supervisor_version != worker.supervisor_version,
        )
    )
    return WorkerDesiredVersionsResponse(
        should_update=should_update,
        update_channel=target.update_channel,
        anyharness_version=target.desired_anyharness_version,
        worker_version=target.desired_worker_version,
        supervisor_version=target.desired_supervisor_version,
    )


def _desired_versions_match_worker(
    *,
    target: targets_store.CloudTargetSnapshot,
    worker: worker_auth_store.CloudWorkerSnapshot,
) -> bool:
    desired_and_current = (
        (target.desired_anyharness_version, worker.anyharness_version),
        (target.desired_worker_version, worker.worker_version),
        (target.desired_supervisor_version, worker.supervisor_version),
    )
    has_desired_version = any(desired is not None for desired, _current in desired_and_current)
    if not has_desired_version:
        return False
    return all(
        desired is None or desired == current for desired, current in desired_and_current
    )


def _desired_version_for_component(
    target: targets_store.CloudTargetSnapshot,
    component: str,
) -> str | None:
    if component == "anyharness":
        return target.desired_anyharness_version
    if component == "worker":
        return target.desired_worker_version
    if component == "supervisor":
        return target.desired_supervisor_version
    return None


def _require_expected_update_version(
    *,
    target: targets_store.CloudTargetSnapshot,
    status_value: str,
    component: str | None,
    version: str | None,
) -> None:
    if status_value not in {
        "staged",
        "applying",
        "applied",
    }:
        return
    if component is None or version is None:
        raise CloudApiError(
            "cloud_worker_update_component_required",
            "Worker update component and version are required for this update status.",
            status_code=400,
        )
    desired_version = _desired_version_for_component(target, component)
    if desired_version != version:
        raise CloudApiError(
            "cloud_worker_update_version_stale",
            "Worker update version does not match the target desired version.",
            status_code=409,
        )


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
    worker_token = secrets.token_urlsafe(48)
    worker = await worker_auth_store.create_worker(
        db,
        target_id=enrollment.target_id,
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
    if body.inventory is not None:
        await _record_inventory_payload(
            db,
            target_id=worker.target_id,
            worker_id=worker.id,
            payload=body.inventory,
        )
    await _publish_current_target_patch(db, target_id=worker.target_id)
    return WorkerEnrollResponse(
        target_id=str(worker.target_id),
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
    return WorkerAuthContext(worker_id=worker.id, target_id=worker.target_id)


async def record_heartbeat(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerHeartbeatRequest,
) -> WorkerHeartbeatResponse:
    status_value = validate_worker_status(body.status)
    now = utcnow()
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
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    desired_versions = _desired_versions_response(target=target, worker=worker)
    if (
        target.update_status in _ACTIVE_TARGET_UPDATE_STATUSES
        and _desired_versions_match_worker(target=target, worker=worker)
    ):
        target = (
            await targets_store.record_target_update_status(
                db,
                target_id=auth.target_id,
                status_value=CloudTargetUpdateStatus.applied.value,
                status_detail="Desired versions reported by worker.",
                component=None,
                version=None,
                reported_at=now,
            )
            or target
        )
    await publish_target_patch_after_commit(db, target)
    return WorkerHeartbeatResponse(
        target_id=str(auth.target_id),
        worker_id=str(auth.worker_id),
        status=status_value,
        server_time=now.isoformat(),
        desired_versions=desired_versions,
    )


async def record_inventory(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerInventoryRequest,
) -> WorkerInventoryResponse:
    status_value = validate_worker_status(body.status)
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
    _require_expected_update_version(
        target=current_target,
        status_value=status_value,
        component=component,
        version=version,
    )
    target = await targets_store.record_target_update_status(
        db,
        target_id=auth.target_id,
        status_value=status_value,
        status_detail=detail,
        component=component,
        version=version,
        reported_at=utcnow(),
    )
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
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
        await publish_command_status_after_commit(db, command)
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
            now=now,
        )
    if command is None:
        raise CloudApiError(
            "cloud_worker_command_not_leased",
            "Command is not leased by this worker.",
            status_code=404,
        )
    await publish_command_status_after_commit(db, command)
    return WorkerCommandStatusResponse(
        command_id=str(command.id),
        status=command.status,
        updated=True,
    )


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
        now=utcnow(),
    )
    if command is None:
        raise CloudApiError(
            "cloud_worker_command_not_leased",
            "Command is not leased by this worker.",
            status_code=404,
        )
    await publish_command_status_after_commit(db, command)
    return WorkerCommandStatusResponse(
        command_id=str(command.id),
        status=command.status,
        updated=True,
    )


async def record_event_batch(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerEventBatchRequest,
) -> WorkerEventBatchResponse:
    with defer_live_publishes_until_commit(db):
        return await ingest_worker_event_batch(db, auth=auth, body=body)
