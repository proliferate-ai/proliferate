"""HTTP routes for runtime worker enrollment + heartbeat.

- ``worker_router`` holds the worker-authenticated (bearer) endpoints the
  enrolled process calls: enroll (with the one-time enrollment token) and
  heartbeat.
- ``router`` holds the user-authenticated endpoint the desktop app calls to
  mint an enrollment token for its install.
- ``admin_router`` (``/workers/admin``): instance-admin-authenticated
  target-scoped desired-version management (admin authorization is enforced
  inside the service, following the ``integrations`` admin-router convention).
"""

from __future__ import annotations

from uuid import UUID

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
    SetSandboxDesiredVersionsRequest,
    SetSandboxDesiredVersionsResponse,
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
    runtime_artifact_redirect_url,
    runtime_artifact_versioned_redirect_url,
    set_sandbox_desired_versions,
    worker_artifact_redirect_url,
    worker_artifact_versioned_redirect_url,
)

worker_router = APIRouter(tags=["cloud-runtime-worker"])
router = APIRouter(tags=["cloud-runtime-worker"])
admin_router = APIRouter(prefix="/workers/admin", tags=["cloud-runtime-worker-admin"])


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


@worker_router.get("/runtime/download/{target}/{asset}")
async def runtime_artifact_download_endpoint(target: str, asset: str) -> RedirectResponse:
    """302 to the pinned AnyHarness binary (or its ``.sha256``) on the downloads CDN.

    Unauthenticated by design, like the worker artifact redirect: the sandbox
    worker fetches the runtime binary over a public CDN URL behind this 302, so
    the sandbox never needs GitHub egress or credentials.
    """
    url = await runtime_artifact_redirect_url(target=target, asset=asset)
    return RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)


@worker_router.get("/worker/download/{target}/{version}/{asset}")
async def worker_artifact_versioned_download_endpoint(
    target: str, version: str, asset: str
) -> RedirectResponse:
    """302 to the worker binary at an EXACT version (R9R-001).

    The version-specific path a supervisor-owned Worker resolves for an update
    request: the server resolves the requested version or fails closed (404) —
    it never falls back to the rolling ``stable`` path, so a B-pinned sandbox is
    never handed an A-labelled artifact.
    """
    url = await worker_artifact_versioned_redirect_url(target=target, version=version, asset=asset)
    return RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)


@worker_router.get("/runtime/download/{target}/{version}/{asset}")
async def runtime_artifact_versioned_download_endpoint(
    target: str, version: str, asset: str
) -> RedirectResponse:
    """302 to the AnyHarness binary at an EXACT version (R9R-001).

    The runtime parallel of the versioned worker download: exact-version
    resolution, fail closed on an unpublished version, no rolling fallback.
    """
    url = await runtime_artifact_versioned_redirect_url(
        target=target, version=version, asset=asset
    )
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
        organization_id=body.organization_id,
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


@admin_router.put(
    "/sandboxes/{cloud_sandbox_id}/desired-versions",
    response_model=SetSandboxDesiredVersionsResponse,
)
async def set_sandbox_desired_versions_endpoint(
    cloud_sandbox_id: UUID,
    body: SetSandboxDesiredVersionsRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> SetSandboxDesiredVersionsResponse:
    return await set_sandbox_desired_versions(
        db,
        cloud_sandbox_id=cloud_sandbox_id,
        actor_user_id=user.id,
        desired_anyharness_version=body.desired_anyharness_version,
        desired_worker_version=body.desired_worker_version,
    )
