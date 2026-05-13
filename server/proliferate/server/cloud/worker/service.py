"""Worker-facing cloud sync orchestration."""

from __future__ import annotations

import secrets
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sync.commands import (
    lease_next_command,
    mark_command_delivery,
    mark_command_result,
)
from proliferate.db.store.cloud_sync.events import append_event
from proliferate.db.store.cloud_sync.targets import (
    authenticate_worker,
    consume_enrollment_token,
    create_target_for_enrollment,
    create_worker,
    upsert_target_inventory,
    upsert_target_status,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.worker.models import (
    CommandDeliveryRequest,
    CommandResultRequest,
    EventBatchUploadRequest,
    EventBatchUploadResponse,
    LeaseCommandResponse,
    WorkerEnrollResponse,
    WorkerHeartbeatResponse,
    WorkerHeartbeatRequest,
    WorkerInventoryRequest,
    lease_response,
)
from proliferate.utils.time import utcnow


async def enroll_worker(
    db: AsyncSession,
    *,
    enrollment_token: str,
    install_id: str,
    worker_version: str | None,
    anyharness_version: str | None,
) -> WorkerEnrollResponse:
    enrollment = await consume_enrollment_token(db, token=enrollment_token)
    if enrollment is None:
        raise CloudApiError("invalid_enrollment_token", "Invalid enrollment token.", status_code=401)
    if enrollment.target_id is None:
        target = await create_target_for_enrollment(
            db,
            enrollment=enrollment,
            owner_user_id=enrollment.created_by_user_id,
        )
        target_id = target.id
    else:
        target_id = enrollment.target_id
    worker_token = secrets.token_urlsafe(32)
    worker = await create_worker(
        db,
        target_id=target_id,
        org_id=enrollment.org_id,
        install_id=install_id,
        token=worker_token,
        worker_version=worker_version,
        anyharness_version=anyharness_version,
    )
    return WorkerEnrollResponse(
        target_id=target_id,
        worker_id=worker.id,
        worker_token=worker_token,
        cloud_base_url=None,
    )


async def authenticate_worker_token(
    db: AsyncSession,
    *,
    worker_id: UUID,
    target_id: UUID,
    token: str,
) -> tuple[UUID, UUID, UUID]:
    worker = await authenticate_worker(db, worker_id=worker_id, target_id=target_id, token=token)
    if worker is None:
        raise CloudApiError("worker_unauthorized", "Worker is not authorized.", status_code=401)
    return worker.id, worker.target_id, worker.org_id


async def record_heartbeat(
    db: AsyncSession,
    *,
    target_id: UUID,
    body: WorkerHeartbeatRequest,
) -> WorkerHeartbeatResponse:
    await upsert_target_status(
        db,
        target_id=target_id,
        online_status=body.online_status,
        worker_connected=True,
        anyharness_reachable=body.anyharness_reachable,
        anyharness_version=body.anyharness_version,
        worker_version=body.worker_version,
        supervisor_version=body.supervisor_version,
        safe_stop_state=body.safe_stop_state,
        safe_stop_reasons=body.safe_stop_reasons,
        active_session_count=body.active_session_count,
        active_turn_count=body.active_turn_count,
        pending_interaction_count=body.pending_interaction_count,
        active_terminal_count=body.active_terminal_count,
        active_process_count=body.active_process_count,
    )
    return WorkerHeartbeatResponse(ok=True, server_time=utcnow())


async def record_inventory(
    db: AsyncSession,
    *,
    target_id: UUID,
    body: WorkerInventoryRequest,
) -> WorkerHeartbeatResponse:
    await upsert_target_inventory(
        db,
        target_id=target_id,
        os_kind=body.os_kind,
        os_version=body.os_version,
        arch=body.arch,
        distro=body.distro,
        shell=body.shell,
        package_managers=body.package_managers,
        workspace_roots=body.workspace_roots,
        capabilities=body.capabilities,
        tool_versions=body.tool_versions,
        provider_readiness=body.provider_readiness,
        mcp_readiness=body.mcp_readiness,
        agent_catalog_revision=body.agent_catalog_revision,
    )
    return WorkerHeartbeatResponse(ok=True, server_time=utcnow())


async def lease_worker_command(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID,
    lease_seconds: int,
) -> LeaseCommandResponse:
    lease = await lease_next_command(
        db,
        target_id=target_id,
        worker_id=worker_id,
        lease_seconds=lease_seconds,
    )
    return lease_response(lease)


async def record_command_delivery(
    db: AsyncSession,
    *,
    command_id: UUID,
    body: CommandDeliveryRequest,
) -> None:
    command = await mark_command_delivery(
        db,
        command_id=command_id,
        status=body.status,
        error_code=body.error_code,
        error_message=body.error_message,
    )
    if command is None:
        raise CloudApiError("command_not_found", "Command not found.", status_code=404)


async def record_command_result(
    db: AsyncSession,
    *,
    command_id: UUID,
    body: CommandResultRequest,
) -> None:
    command = await mark_command_result(
        db,
        command_id=command_id,
        status=body.status,
        error_code=body.error_code,
        error_message=body.error_message,
    )
    if command is None:
        raise CloudApiError("command_not_found", "Command not found.", status_code=404)


async def ingest_event_batch(
    db: AsyncSession,
    *,
    org_id: UUID,
    target_id: UUID,
    body: EventBatchUploadRequest,
) -> EventBatchUploadResponse:
    inserted = 0
    duplicates = 0
    for event in body.events:
        result = await append_event(
            db,
            org_id=org_id,
            target_id=target_id,
            workspace_id=event.workspace_id,
            session_id=event.session_id,
            anyharness_event_id=event.anyharness_event_id,
            anyharness_sequence=event.anyharness_sequence,
            event_type=event.event_type,
            schema_version=event.schema_version,
            source_kind=event.source_kind,
            actor_user_id=event.actor_user_id,
            actor_external_id=event.actor_external_id,
            created_at=event.created_at,
            payload=event.payload,
            payload_ref=event.payload_ref,
            payload_size_bytes=event.payload_size_bytes,
            payload_hash=event.payload_hash,
        )
        if result.inserted:
            inserted += 1
        else:
            duplicates += 1
    return EventBatchUploadResponse(inserted_count=inserted, duplicate_count=duplicates)
