"""Worker-facing cloud control-plane routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.events.models import (
    WorkerEventBatchRequest,
    WorkerEventBatchResponse,
)
from proliferate.server.cloud.worker.models import (
    WorkerCommandDeliveryRequest,
    WorkerCommandLeaseRequest,
    WorkerCommandLeaseResponse,
    WorkerCommandResultRequest,
    WorkerCommandStatusResponse,
    WorkerEnrollRequest,
    WorkerEnrollResponse,
    WorkerHeartbeatRequest,
    WorkerHeartbeatResponse,
    WorkerInventoryRequest,
    WorkerInventoryResponse,
)
from proliferate.server.cloud.worker.service import (
    authenticate_worker,
    enroll_worker,
    lease_worker_command,
    record_command_delivery,
    record_command_result,
    record_event_batch,
    record_heartbeat,
    record_inventory,
)

router = APIRouter(prefix="/worker", tags=["cloud-worker"])


@router.post("/enroll", response_model=WorkerEnrollResponse)
async def enroll_worker_endpoint(
    body: WorkerEnrollRequest,
    db: AsyncSession = Depends(get_async_session),
) -> WorkerEnrollResponse:
    try:
        return await enroll_worker(db, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/heartbeat", response_model=WorkerHeartbeatResponse)
async def worker_heartbeat_endpoint(
    body: WorkerHeartbeatRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerHeartbeatResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await record_heartbeat(db, auth=auth, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/inventory", response_model=WorkerInventoryResponse)
async def worker_inventory_endpoint(
    body: WorkerInventoryRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerInventoryResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await record_inventory(db, auth=auth, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/commands/lease", response_model=WorkerCommandLeaseResponse)
async def worker_command_lease_endpoint(
    body: WorkerCommandLeaseRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerCommandLeaseResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await lease_worker_command(db, auth=auth, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/commands/{command_id}/delivery", response_model=WorkerCommandStatusResponse)
async def worker_command_delivery_endpoint(
    command_id: UUID,
    body: WorkerCommandDeliveryRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerCommandStatusResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await record_command_delivery(
            db,
            auth=auth,
            command_id=command_id,
            body=body,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/commands/{command_id}/result", response_model=WorkerCommandStatusResponse)
async def worker_command_result_endpoint(
    command_id: UUID,
    body: WorkerCommandResultRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerCommandStatusResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await record_command_result(
            db,
            auth=auth,
            command_id=command_id,
            body=body,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/events/batches", response_model=WorkerEventBatchResponse)
async def worker_event_batch_endpoint(
    body: WorkerEventBatchRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerEventBatchResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await record_event_batch(db, auth=auth, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)
