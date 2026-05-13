"""Worker-facing cloud sync orchestration."""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sync.commands import (
    CommandStatus,
    lease_next_commands,
    mark_command_delivery,
    mark_command_result,
)
from proliferate.db.store.cloud_sync.events import (
    EventSourceKind,
    SessionEventInsert,
    append_session_events,
)
from proliferate.db.store.cloud_sync.target_records import (
    AnyHarnessEndpointKind,
    HeartbeatReport,
    InventoryReport,
    SafeStopState,
)
from proliferate.db.store.cloud_sync.targets import (
    consume_enrollment_for_worker,
    get_active_worker_by_credential,
    update_worker_heartbeat,
    upsert_target_inventory,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.worker.models import (
    CommandDeliveryRequest,
    CommandResultRequest,
    EventBatchUploadRequest,
    EventBatchUploadResponse,
    LeaseCommandResponse,
    WorkerEnrollResponse,
    WorkerHeartbeatRequest,
    WorkerHeartbeatResponse,
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
    worker_token = secrets.token_urlsafe(32)
    enrollment = await consume_enrollment_for_worker(
        db,
        token_hash=_sha256(enrollment_token),
        worker_credential_hash=_sha256(worker_token),
        install_id=install_id,
        worker_version=worker_version,
        supervisor_version=None,
        endpoint_kind=AnyHarnessEndpointKind.http,
        inventory=None,
        now=utcnow(),
    )
    if enrollment is None:
        raise CloudApiError(
            "invalid_enrollment_token",
            "Invalid enrollment token.",
            status_code=401,
        )
    return WorkerEnrollResponse(
        target_id=enrollment.target.id,
        worker_id=enrollment.worker.id,
        worker_token=worker_token,
        cloud_base_url=None,
        credential_kind="bearer",
    )


async def authenticate_worker_token(
    db: AsyncSession,
    *,
    worker_id: UUID,
    target_id: UUID,
    token: str,
) -> tuple[UUID, UUID, UUID]:
    worker = await get_active_worker_by_credential(
        db,
        worker_id=worker_id,
        target_id=target_id,
        credential_hash=_sha256(token),
    )
    if worker is None:
        raise CloudApiError("worker_unauthorized", "Worker is not authorized.", status_code=401)
    return worker.id, worker.target_id, worker.org_id


async def record_heartbeat(
    db: AsyncSession,
    *,
    worker_id: UUID,
    target_id: UUID,
    body: WorkerHeartbeatRequest,
) -> WorkerHeartbeatResponse:
    status = await update_worker_heartbeat(
        db,
        worker_id=worker_id,
        target_id=target_id,
        report=HeartbeatReport(
            heartbeat_id=body.heartbeat_id,
            worker_version=body.worker_version,
            supervisor_version=body.supervisor_version,
            anyharness_version=body.anyharness_version,
            worker_connected=body.online_status != "offline",
            anyharness_reachable=body.anyharness_reachable,
            safe_stop_state=SafeStopState(body.safe_stop_state),
            safe_stop_reasons=body.safe_stop_reasons,
            active_session_count=body.active_session_count,
            active_turn_count=body.active_turn_count,
            pending_interaction_count=body.pending_interaction_count,
            active_terminal_count=body.active_terminal_count,
            active_process_count=body.active_process_count,
            last_activity_at=body.last_activity_at,
        ),
        now=utcnow(),
    )
    if status is None:
        raise CloudApiError("target_not_found", "Target not found.", status_code=404)
    return WorkerHeartbeatResponse(ok=True, server_time=utcnow())


async def record_inventory(
    db: AsyncSession,
    *,
    target_id: UUID,
    body: WorkerInventoryRequest,
) -> WorkerHeartbeatResponse:
    inventory = await upsert_target_inventory(
        db,
        target_id=target_id,
        report=_inventory_report(body),
        now=utcnow(),
    )
    if inventory is None:
        raise CloudApiError("target_not_found", "Target not found.", status_code=404)
    return WorkerHeartbeatResponse(ok=True, server_time=utcnow())


async def lease_worker_commands(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID,
    lease_seconds: int,
    max_commands: int,
) -> LeaseCommandResponse:
    now = utcnow()
    leases = await lease_next_commands(
        db,
        target_id=target_id,
        worker_id=worker_id,
        lease_expires_at=now + timedelta(seconds=lease_seconds),
        now=now,
        limit=max_commands,
    )
    return lease_response(leases)


async def record_command_delivery(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    body: CommandDeliveryRequest,
) -> None:
    command = await mark_command_delivery(
        db,
        command_id=command_id,
        worker_id=worker_id,
        status=_delivery_status(body.status),
        error_code=body.error_code,
        error_message=body.error_message,
        now=utcnow(),
    )
    if command is None:
        raise CloudApiError("command_not_found", "Command not found.", status_code=404)


async def record_command_result(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    body: CommandResultRequest,
) -> None:
    command = await mark_command_result(
        db,
        command_id=command_id,
        worker_id=worker_id,
        status=_result_status(body.status),
        error_code=body.error_code,
        error_message=body.error_message,
        now=utcnow(),
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
    now = utcnow()
    events = tuple(
        SessionEventInsert(
            org_id=org_id,
            target_id=target_id,
            workspace_id=event.workspace_id,
            session_id=event.session_id,
            anyharness_event_id=event.anyharness_event_id,
            anyharness_sequence=event.anyharness_sequence,
            event_type=event.event_type,
            schema_version=event.schema_version,
            source_kind=_event_source_kind(event.source_kind),
            actor_user_id=event.actor_user_id,
            actor_external_id=event.actor_external_id,
            created_at=event.created_at,
            payload=event.payload,
            payload_ref=event.payload_ref,
            payload_size_bytes=event.payload_size_bytes,
            payload_hash=event.payload_hash or _payload_hash(event.payload),
            dedupe_key=event.dedupe_key
            or f"{target_id}:{event.session_id}:{event.anyharness_sequence}",
            ingested_at=now,
        )
        for event in body.all_events()
    )
    result = await append_session_events(db, events=events)
    last_ack_seq = max((event.anyharness_sequence for event in body.all_events()), default=None)
    return EventBatchUploadResponse(
        accepted=result.conflict_count == 0,
        last_ack_seq=last_ack_seq,
        inserted_count=len(result.inserted_events),
        duplicate_count=result.duplicate_count,
        conflict_count=result.conflict_count,
    )


def _inventory_report(body: WorkerInventoryRequest) -> InventoryReport:
    capabilities = body.capabilities
    versions = body.tool_versions
    return InventoryReport(
        os_kind=body.os_kind,
        os_version=body.os_version,
        arch=body.arch,
        distro=body.distro,
        shell=body.shell,
        package_managers={name: True for name in body.package_managers},
        workspace_roots={"roots": body.workspace_roots},
        supports_process_spawn=bool(capabilities.get("supportsProcessSpawn", True)),
        supports_pty=bool(capabilities.get("supportsPty", False)),
        supports_filesystem=bool(capabilities.get("supportsFilesystem", True)),
        supports_git=bool(capabilities.get("supportsGit", False)),
        supports_network_egress=bool(capabilities.get("supportsNetworkEgress", True)),
        supports_port_forwarding=bool(capabilities.get("supportsPortForwarding", False)),
        supports_browser=bool(capabilities.get("supportsBrowser", False)),
        supports_computer_use=bool(capabilities.get("supportsComputerUse", False)),
        supports_docker=bool(capabilities.get("supportsDocker", False)),
        node_version=_string_or_none(versions.get("nodeVersion")),
        npm_version=_string_or_none(versions.get("npmVersion")),
        python_version=_string_or_none(versions.get("pythonVersion")),
        uv_version=_string_or_none(versions.get("uvVersion")),
        git_version=_string_or_none(versions.get("gitVersion")),
        provider_readiness=body.provider_readiness,
        mcp_readiness=body.mcp_readiness,
        agent_catalog_revision=body.agent_catalog_revision,
        reported_at=body.reported_at,
    )


def _delivery_status(status: str) -> CommandStatus:
    if status == "delivered":
        return CommandStatus.delivered
    return CommandStatus.failed_delivery


def _result_status(status: str) -> CommandStatus:
    if status in {"accepted", "accepted_but_queued", "rejected"}:
        return CommandStatus(status)
    return CommandStatus.rejected


def _event_source_kind(source_kind: str) -> EventSourceKind:
    try:
        return EventSourceKind(source_kind)
    except ValueError:
        return EventSourceKind.target


def _payload_hash(payload: dict[str, object] | None) -> str:
    return _sha256_json(payload or {})


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _sha256_json(value: dict[str, object]) -> str:
    import json

    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return _sha256(encoded)


def _string_or_none(value: object | None) -> str | None:
    return value if isinstance(value, str) else None
