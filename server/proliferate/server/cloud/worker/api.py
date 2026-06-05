"""Worker-facing cloud control-plane routes."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.events.models import (
    WorkerEventBatchRequest,
    WorkerEventBatchResponse,
)
from proliferate.server.cloud.worker.commands import (
    record_command_delivery,
    record_command_result,
)
from proliferate.server.cloud.worker.control.service import wait_for_worker_control
from proliferate.server.cloud.worker.models import (
    WorkerCommandDeliveryRequest,
    WorkerCommandLeaseRequest,
    WorkerCommandLeaseResponse,
    WorkerCommandResultRequest,
    WorkerCommandStatusResponse,
    WorkerControlWaitRequest,
    WorkerControlWaitResponse,
    WorkerEnrollRequest,
    WorkerEnrollResponse,
    WorkerExposureListResponse,
    WorkerHeartbeatRequest,
    WorkerHeartbeatResponse,
    WorkerInventoryRequest,
    WorkerInventoryResponse,
    WorkerMaterializationReportRequest,
    WorkerMaterializationReportResponse,
    WorkerProjectionGapRequest,
    WorkerProjectionGapResponse,
    WorkerRevokedJtisResponse,
    WorkerUpdateStatusRequest,
    WorkerUpdateStatusResponse,
)
from proliferate.server.cloud.worker.revoked_jti import list_revoked_jtis
from proliferate.server.cloud.worker.service import (
    authenticate_worker,
    enroll_worker,
    list_worker_exposures,
    record_event_batch,
    record_heartbeat,
    record_inventory,
    record_projection_gap,
    record_update_status,
)
from proliferate.server.cloud.worker.transactions import (
    lease_worker_command_and_commit_if_needed,
    record_materialization_report_and_commit,
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


@router.post("/materialization-reports", response_model=WorkerMaterializationReportResponse)
async def worker_materialization_report_endpoint(
    body: WorkerMaterializationReportRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerMaterializationReportResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await record_materialization_report_and_commit(db, auth=auth, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/update-status", response_model=WorkerUpdateStatusResponse)
async def worker_update_status_endpoint(
    body: WorkerUpdateStatusRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerUpdateStatusResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await record_update_status(db, auth=auth, body=body)
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
        return await lease_worker_command_and_commit_if_needed(db, auth=auth, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/control/wait", response_model=WorkerControlWaitResponse)
async def worker_control_wait_endpoint(
    body: WorkerControlWaitRequest,
    authorization: str | None = Header(default=None),
) -> WorkerControlWaitResponse:
    try:
        return await wait_for_worker_control(body=body, authorization=authorization)
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


@router.get("/exposures", response_model=WorkerExposureListResponse)
async def worker_exposures_endpoint(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerExposureListResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await list_worker_exposures(db, auth=auth)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("/revoked-jtis", response_model=WorkerRevokedJtisResponse)
async def worker_revoked_jtis_endpoint(
    since: datetime | None = Query(default=None),
    cursor: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerRevokedJtisResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await list_revoked_jtis(
            db,
            auth=auth,
            cursor=cursor or (since.isoformat() if since is not None else None),
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


@router.post("/events/gaps", response_model=WorkerProjectionGapResponse)
async def worker_event_gap_endpoint(
    body: WorkerProjectionGapRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerProjectionGapResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await record_projection_gap(db, auth=auth, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)
