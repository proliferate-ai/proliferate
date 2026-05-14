"""Worker-facing cloud control-plane routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.worker.models import (
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
