"""HTTP routes for runtime worker enrollment + heartbeat.

- ``worker_router`` holds the worker-authenticated (bearer) endpoints the
  enrolled process calls: enroll (with the one-time enrollment token) and
  heartbeat.
- ``router`` holds the user-authenticated endpoint the desktop app calls to
  mint an enrollment token for its install.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.runtime_workers.auth import (
    WorkerAuthContext,
    authenticate_worker,
)
from proliferate.server.cloud.runtime_workers.models import (
    DesktopWorkerEnrollmentRequest,
    DesktopWorkerEnrollmentResponse,
    DesktopWorkerRevokeRequest,
    DesktopWorkerRevokeResponse,
    WorkerEnrollRequest,
    WorkerEnrollResponse,
    WorkerHeartbeatRequest,
    WorkerHeartbeatResponse,
)
from proliferate.server.cloud.runtime_workers.service import (
    create_desktop_enrollment,
    enroll_worker,
    record_heartbeat,
    revoke_desktop_worker,
    worker_artifact_redirect_url,
)

worker_router = APIRouter(tags=["cloud-runtime-worker"])
router = APIRouter(tags=["cloud-runtime-worker"])


@worker_router.post("/worker/enroll", response_model=WorkerEnrollResponse)
async def enroll_worker_endpoint(
    body: WorkerEnrollRequest,
    db: AsyncSession = Depends(get_async_session),
) -> WorkerEnrollResponse:
    return await enroll_worker(db, request=body)


@worker_router.post("/worker/heartbeat", response_model=WorkerHeartbeatResponse)
async def worker_heartbeat_endpoint(
    body: WorkerHeartbeatRequest,
    auth: WorkerAuthContext = Depends(authenticate_worker),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerHeartbeatResponse:
    return await record_heartbeat(
        db,
        worker_id=auth.worker_id,
        worker_version=body.worker_version,
        anyharness_version=body.anyharness_version,
    )


@worker_router.get("/worker/download/{target}/{asset}")
async def worker_artifact_download_endpoint(target: str, asset: str) -> RedirectResponse:
    """302 to the pinned worker binary (or its ``.sha256``) on the downloads CDN.

    Unauthenticated by design, like the desktop updater redirect: install
    scripts fetch the binary before any worker identity exists, and the CDN
    artifacts are public.
    """
    url = await worker_artifact_redirect_url(target=target, asset=asset)
    return RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)


@router.post(
    "/workers/desktop/enrollment",
    response_model=DesktopWorkerEnrollmentResponse,
)
async def create_desktop_worker_enrollment_endpoint(
    body: DesktopWorkerEnrollmentRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> DesktopWorkerEnrollmentResponse:
    return await create_desktop_enrollment(
        db,
        owner_user_id=user.id,
        desktop_install_id=body.desktop_install_id,
    )


@router.post(
    "/workers/desktop/revoke",
    response_model=DesktopWorkerRevokeResponse,
)
async def revoke_desktop_worker_endpoint(
    body: DesktopWorkerRevokeRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> DesktopWorkerRevokeResponse:
    return await revoke_desktop_worker(
        db,
        owner_user_id=user.id,
        desktop_install_id=body.desktop_install_id,
    )
