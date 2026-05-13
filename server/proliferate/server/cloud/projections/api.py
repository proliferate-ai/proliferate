"""Cloud projection read routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.projections.models import ProjectionResponse
from proliferate.server.cloud.projections.service import get_cloud_projection

router = APIRouter(prefix="/projections", tags=["cloud-projections"])


@router.get("/{projection_kind}/{projection_id}", response_model=ProjectionResponse)
async def get_cloud_projection_endpoint(
    projection_kind: str,
    projection_id: UUID,
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> ProjectionResponse:
    try:
        return await get_cloud_projection(
            db,
            projection_kind=projection_kind,
            projection_id=projection_id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
