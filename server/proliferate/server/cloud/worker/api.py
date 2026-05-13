"""Worker-facing cloud sync routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.worker.models import (
    CommandDeliveryRequest,
    CommandResultRequest,
    EventBatchUploadRequest,
    EventBatchUploadResponse,
    LeaseCommandRequest,
    LeaseCommandResponse,
    WorkerEnrollRequest,
    WorkerEnrollResponse,
    WorkerHeartbeatRequest,
    WorkerHeartbeatResponse,
    WorkerInventoryRequest,
)
from proliferate.server.cloud.worker.service import (
    authenticate_worker_token,
    enroll_worker,
    ingest_event_batch,
    lease_worker_command,
    record_command_delivery,
    record_command_result,
    record_heartbeat,
    record_inventory,
)

router = APIRouter(prefix="/worker", tags=["cloud-worker"])


def _extract_bearer_token(authorization: str | None) -> str:
    if authorization is None or not authorization.startswith("Bearer "):
        raise CloudApiError("worker_unauthorized", "Worker is not authorized.", status_code=401)
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise CloudApiError("worker_unauthorized", "Worker is not authorized.", status_code=401)
    return token


async def _worker_identity(
    worker_id: UUID = Header(alias="X-Proliferate-Worker-Id"),
    target_id: UUID = Header(alias="X-Proliferate-Target-Id"),
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: AsyncSession = Depends(get_async_session),
) -> tuple[UUID, UUID, UUID]:
    try:
        return await authenticate_worker_token(
            db,
            worker_id=worker_id,
            target_id=target_id,
            token=_extract_bearer_token(authorization),
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/enroll", response_model=WorkerEnrollResponse)
async def enroll_worker_endpoint(
    body: WorkerEnrollRequest,
    db: AsyncSession = Depends(get_async_session),
) -> WorkerEnrollResponse:
    try:
        return await enroll_worker(
            db,
            enrollment_token=body.enrollment_token,
            install_id=body.install_id,
            worker_version=body.worker_version,
            anyharness_version=body.anyharness_version,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/heartbeat", response_model=WorkerHeartbeatResponse)
async def worker_heartbeat_endpoint(
    body: WorkerHeartbeatRequest,
    identity: tuple[UUID, UUID, UUID] = Depends(_worker_identity),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerHeartbeatResponse:
    _, target_id, _ = identity
    try:
        return await record_heartbeat(db, target_id=target_id, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/inventory", response_model=WorkerHeartbeatResponse)
async def worker_inventory_endpoint(
    body: WorkerInventoryRequest,
    identity: tuple[UUID, UUID, UUID] = Depends(_worker_identity),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerHeartbeatResponse:
    _, target_id, _ = identity
    try:
        return await record_inventory(db, target_id=target_id, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/commands/lease", response_model=LeaseCommandResponse)
async def lease_worker_command_endpoint(
    body: LeaseCommandRequest,
    identity: tuple[UUID, UUID, UUID] = Depends(_worker_identity),
    db: AsyncSession = Depends(get_async_session),
) -> LeaseCommandResponse:
    worker_id, target_id, _ = identity
    try:
        return await lease_worker_command(
            db,
            target_id=target_id,
            worker_id=worker_id,
            lease_seconds=body.lease_seconds,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/commands/{command_id}/delivery")
async def worker_command_delivery_endpoint(
    command_id: UUID,
    body: CommandDeliveryRequest,
    _: tuple[UUID, UUID, UUID] = Depends(_worker_identity),
    db: AsyncSession = Depends(get_async_session),
) -> dict[str, bool]:
    try:
        await record_command_delivery(db, command_id=command_id, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)
    return {"ok": True}


@router.post("/commands/{command_id}/result")
async def worker_command_result_endpoint(
    command_id: UUID,
    body: CommandResultRequest,
    _: tuple[UUID, UUID, UUID] = Depends(_worker_identity),
    db: AsyncSession = Depends(get_async_session),
) -> dict[str, bool]:
    try:
        await record_command_result(db, command_id=command_id, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)
    return {"ok": True}


@router.post("/events/batches", response_model=EventBatchUploadResponse)
async def worker_event_batch_endpoint(
    body: EventBatchUploadRequest,
    identity: tuple[UUID, UUID, UUID] = Depends(_worker_identity),
    db: AsyncSession = Depends(get_async_session),
) -> EventBatchUploadResponse:
    _, target_id, org_id = identity
    try:
        return await ingest_event_batch(db, org_id=org_id, target_id=target_id, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)
