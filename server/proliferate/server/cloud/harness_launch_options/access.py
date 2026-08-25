from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.server.api_errors import CloudApiError
from proliferate.server.seam.workers.auth import WorkerAuthContext, authenticate_worker


async def current_launch_options_worker_target(
    auth: WorkerAuthContext = Depends(authenticate_worker),
) -> UUID:
    if auth.runtime_kind != "cloud_sandbox" or auth.cloud_sandbox_id is None:
        raise CloudApiError(
            "launch_options_target_required",
            "Launch options require a cloud sandbox target.",
            status_code=403,
        )
    return auth.cloud_sandbox_id


async def current_launch_options_sandbox(
    cloud_sandbox_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudSandboxValue:
    sandbox = await sandbox_store.load_cloud_sandbox_by_id(db, cloud_sandbox_id)
    if sandbox is None or sandbox.owner_user_id != user.id:
        raise CloudApiError("cloud_sandbox_not_found", "Cloud sandbox not found.", status_code=404)
    return sandbox


LaunchOptionsWorkerTarget = Annotated[UUID, Depends(current_launch_options_worker_target)]
LaunchOptionsSandboxAccess = Annotated[
    CloudSandboxValue,
    Depends(current_launch_options_sandbox),
]
