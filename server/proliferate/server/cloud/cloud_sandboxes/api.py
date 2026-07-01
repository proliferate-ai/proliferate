"""HTTP routes for cloud sandboxes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.cloud_sandboxes.models import (
    CloudSandboxResponse,
    cloud_sandbox_payload,
)
from proliferate.server.cloud.cloud_sandboxes.service import (
    destroy_cloud_sandbox,
    ensure_cloud_sandbox_ready,
    get_cloud_sandbox_detail,
    wake_cloud_sandbox,
)

router = APIRouter(tags=["cloud-cloud-sandbox"])


@router.get("/cloud-sandbox", response_model=CloudSandboxResponse | None)
async def get_cloud_sandbox_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSandboxResponse | None:
    sandbox = await get_cloud_sandbox_detail(db, user)
    return None if sandbox is None else cloud_sandbox_payload(sandbox)


@router.post("/cloud-sandbox/ensure", response_model=CloudSandboxResponse)
async def ensure_cloud_sandbox_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSandboxResponse:
    return cloud_sandbox_payload(await ensure_cloud_sandbox_ready(db, user))


@router.post("/cloud-sandbox/wake", response_model=CloudSandboxResponse)
async def wake_cloud_sandbox_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSandboxResponse:
    return cloud_sandbox_payload(await wake_cloud_sandbox(db, user))


@router.delete("/cloud-sandbox", response_model=CloudSandboxResponse | None)
async def destroy_cloud_sandbox_endpoint(
    response: Response,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSandboxResponse | None:
    sandbox = await destroy_cloud_sandbox(db, user)
    if sandbox is None:
        response.status_code = 204
        return None
    return cloud_sandbox_payload(sandbox)
