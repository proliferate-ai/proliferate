"""HTTP routes for managed cloud sandboxes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.managed_sandboxes.models import (
    ManagedSandboxResponse,
    managed_sandbox_payload,
)
from proliferate.server.cloud.managed_sandboxes.service import (
    destroy_managed_sandbox,
    ensure_managed_sandbox_ready,
    get_managed_sandbox_detail,
    wake_managed_sandbox,
)

router = APIRouter(tags=["cloud-managed-sandbox"])


@router.get("/managed-sandbox", response_model=ManagedSandboxResponse | None)
async def get_managed_sandbox_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> ManagedSandboxResponse | None:
    sandbox = await get_managed_sandbox_detail(db, user)
    return None if sandbox is None else managed_sandbox_payload(sandbox)


@router.post("/managed-sandbox/ensure", response_model=ManagedSandboxResponse)
async def ensure_managed_sandbox_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> ManagedSandboxResponse:
    return managed_sandbox_payload(await ensure_managed_sandbox_ready(db, user))


@router.post("/managed-sandbox/wake", response_model=ManagedSandboxResponse)
async def wake_managed_sandbox_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> ManagedSandboxResponse:
    return managed_sandbox_payload(await wake_managed_sandbox(db, user))


@router.delete("/managed-sandbox", response_model=ManagedSandboxResponse | None)
async def destroy_managed_sandbox_endpoint(
    response: Response,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> ManagedSandboxResponse | None:
    sandbox = await destroy_managed_sandbox(db, user)
    if sandbox is None:
        response.status_code = 204
        return None
    return managed_sandbox_payload(sandbox)
