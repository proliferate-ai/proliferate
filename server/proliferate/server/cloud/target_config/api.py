"""HTTP routes for cloud target environment materialization."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.target_config.models import (
    CloudTargetConfigResponse,
    MaterializeTargetConfigRequest,
    MaterializeTargetConfigResponse,
    TargetConfigMaterializationPlan,
    WorkerTargetConfigStatusRequest,
    WorkerTargetConfigStatusResponse,
    target_config_payload,
)
from proliferate.server.cloud.target_config.service import (
    get_target_config,
    list_target_configs,
    materialize_target_config,
    record_worker_target_config_status,
    worker_target_config_plan,
)
from proliferate.server.cloud.worker.auth import authenticate_worker

router = APIRouter(prefix="/targets", tags=["cloud-target-config"])
worker_router = APIRouter(prefix="/worker/target-configs", tags=["cloud-worker-target-config"])


@router.get("/{target_id}/configs", response_model=list[CloudTargetConfigResponse])
async def list_target_configs_endpoint(
    target_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> list[CloudTargetConfigResponse]:
    try:
        configs = await list_target_configs(db, target_id=target_id, user_id=user.id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return [target_config_payload(config) for config in configs]


@router.get("/{target_id}/configs/{config_id}", response_model=CloudTargetConfigResponse)
async def get_target_config_endpoint(
    target_id: UUID,
    config_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudTargetConfigResponse:
    try:
        config = await get_target_config(
            db,
            target_id=target_id,
            config_id=config_id,
            user_id=user.id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return target_config_payload(config)


@router.post(
    "/{target_id}/configs/materialize",
    response_model=MaterializeTargetConfigResponse,
)
async def materialize_target_config_endpoint(
    target_id: UUID,
    body: MaterializeTargetConfigRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> MaterializeTargetConfigResponse:
    try:
        return await materialize_target_config(db, target_id=target_id, user=user, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)


@worker_router.get("/{config_id}/materialization", response_model=TargetConfigMaterializationPlan)
async def worker_target_config_materialization_endpoint(
    config_id: UUID,
    command_id: UUID,
    config_version: int,
    lease_id: str,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> TargetConfigMaterializationPlan:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await worker_target_config_plan(
            db,
            auth=auth,
            config_id=config_id,
            command_id=command_id,
            config_version=config_version,
            lease_id=lease_id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@worker_router.post("/{config_id}/status", response_model=WorkerTargetConfigStatusResponse)
async def worker_target_config_status_endpoint(
    config_id: UUID,
    body: WorkerTargetConfigStatusRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerTargetConfigStatusResponse:
    try:
        auth = await authenticate_worker(db, authorization=authorization)
        return await record_worker_target_config_status(
            db,
            auth=auth,
            config_id=config_id,
            body=body,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
