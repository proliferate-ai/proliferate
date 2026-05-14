"""Worker-facing backfill routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.cloud.backfill.models import (
    WorkerBackfillRequest,
    WorkerBackfillResponse,
)
from proliferate.server.cloud.backfill.service import record_worker_backfill
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.worker.service import authenticate_worker

router = APIRouter(prefix="/worker/backfill", tags=["cloud-worker-backfill"])


@router.post("", response_model=WorkerBackfillResponse)
async def worker_backfill_endpoint(
    body: WorkerBackfillRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerBackfillResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await record_worker_backfill(db, auth=auth, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)
