from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.runtime_config.models import (
    DesktopRuntimeConfigApplyRequest,
    DesktopRuntimeConfigApplyResponse,
    RefreshRuntimeConfigRequest,
    RuntimeConfigArtifactResponse,
    RuntimeConfigMaterializationFragment,
    RuntimeConfigStatusResponse,
    WorkerRuntimeConfigCredentialMaterializationRequest,
    WorkerRuntimeConfigCredentialMaterializationResponse,
    WorkerRuntimeConfigStatusRequest,
    WorkerRuntimeConfigStatusResponse,
)
from proliferate.server.cloud.runtime_config.service import (
    desktop_runtime_config_apply_request,
    get_profile_runtime_config_status,
    record_worker_runtime_config_status,
    refresh_profile_runtime_config,
    worker_runtime_config_artifact,
    worker_runtime_config_credentials,
    worker_runtime_config_fragment,
)
from proliferate.server.cloud.sandbox_profiles.service import get_profile
from proliferate.server.cloud.worker.auth import authenticate_worker

router = APIRouter(prefix="/sandbox-profiles", tags=["cloud-runtime-config"])
worker_router = APIRouter(prefix="/worker/runtime-configs", tags=["cloud-worker-runtime-config"])


@router.get("/{sandbox_profile_id}/runtime-config", response_model=RuntimeConfigStatusResponse)
async def get_runtime_config_status_endpoint(
    sandbox_profile_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> RuntimeConfigStatusResponse:
    try:
        await get_profile(db, user=user, sandbox_profile_id=sandbox_profile_id)
        return await get_profile_runtime_config_status(
            db,
            sandbox_profile_id=sandbox_profile_id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post(
    "/{sandbox_profile_id}/runtime-config/refresh", response_model=RuntimeConfigStatusResponse
)
async def refresh_runtime_config_endpoint(
    sandbox_profile_id: UUID,
    body: RefreshRuntimeConfigRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> RuntimeConfigStatusResponse:
    try:
        await get_profile(db, user=user, sandbox_profile_id=sandbox_profile_id)
        return await refresh_profile_runtime_config(
            db,
            sandbox_profile_id=sandbox_profile_id,
            actor_user_id=user.id,
            reason=body.reason,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post(
    "/{sandbox_profile_id}/runtime-config/desktop-apply-request",
    response_model=DesktopRuntimeConfigApplyResponse,
)
async def desktop_runtime_config_apply_request_endpoint(
    sandbox_profile_id: UUID,
    body: DesktopRuntimeConfigApplyRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> DesktopRuntimeConfigApplyResponse:
    try:
        profile = await get_profile(db, user=user, sandbox_profile_id=sandbox_profile_id)
        return await desktop_runtime_config_apply_request(
            db,
            profile=profile,
            target_id=body.target_id,
            actor_user_id=user.id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@worker_router.get(
    "/{revision_id}/materialization",
    response_model=RuntimeConfigMaterializationFragment,
)
async def worker_runtime_config_materialization_endpoint(
    revision_id: UUID,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> RuntimeConfigMaterializationFragment:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await worker_runtime_config_fragment(
            db,
            auth=auth,
            revision_id=revision_id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@worker_router.post("/{revision_id}/status", response_model=WorkerRuntimeConfigStatusResponse)
async def worker_runtime_config_status_endpoint(
    revision_id: UUID,
    body: WorkerRuntimeConfigStatusRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerRuntimeConfigStatusResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await record_worker_runtime_config_status(
            db,
            auth=auth,
            revision_id=revision_id,
            body=body,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@worker_router.post(
    "/{revision_id}/credentials/materialize",
    response_model=WorkerRuntimeConfigCredentialMaterializationResponse,
)
async def worker_runtime_config_credentials_endpoint(
    revision_id: UUID,
    body: WorkerRuntimeConfigCredentialMaterializationRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerRuntimeConfigCredentialMaterializationResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await worker_runtime_config_credentials(
            db,
            auth=auth,
            revision_id=revision_id,
            body=body,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@worker_router.get(
    "/{revision_id}/artifacts/{artifact_hash:path}",
    response_model=RuntimeConfigArtifactResponse,
)
async def worker_runtime_config_artifact_endpoint(
    revision_id: UUID,
    artifact_hash: str,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> RuntimeConfigArtifactResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await worker_runtime_config_artifact(
            db,
            auth=auth,
            revision_id=revision_id,
            artifact_hash=artifact_hash,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
