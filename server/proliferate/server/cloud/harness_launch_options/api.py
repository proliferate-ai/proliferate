from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.cloud.harness_launch_options.access import (
    LaunchOptionsSandboxAccess,
    LaunchOptionsWorkerTarget,
)
from proliferate.server.cloud.harness_launch_options.models import (
    CopiedLaunchOptionsResponse,
    LaunchOptionsCopyRequest,
)
from proliferate.server.cloud.harness_launch_options.service import (
    get_launch_options as get_launch_options_service,
)
from proliferate.server.cloud.harness_launch_options.service import (
    ingest_launch_options as ingest_launch_options_service,
)

router = APIRouter(prefix="/harness-launch-options", tags=["cloud-harness-launch-options"])


@router.post("/{harness_kind}", status_code=204)
async def ingest_launch_options(
    harness_kind: str,
    body: LaunchOptionsCopyRequest,
    cloud_sandbox_id: LaunchOptionsWorkerTarget,
    db: AsyncSession = Depends(get_async_session),
) -> None:
    await ingest_launch_options_service(
        db,
        cloud_sandbox_id=cloud_sandbox_id,
        harness_kind=harness_kind,
        body=body,
    )


@router.get(
    "/sandboxes/{cloud_sandbox_id}/{harness_kind}",
    response_model=CopiedLaunchOptionsResponse,
)
async def get_launch_options(
    sandbox: LaunchOptionsSandboxAccess,
    harness_kind: str,
    db: AsyncSession = Depends(get_async_session),
) -> CopiedLaunchOptionsResponse:
    return await get_launch_options_service(
        db,
        sandbox=sandbox,
        harness_kind=harness_kind,
    )
