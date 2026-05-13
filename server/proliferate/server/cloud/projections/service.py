"""Cloud projection orchestration."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sync.projections import get_projection
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.projections.models import ProjectionResponse, projection_response


async def get_cloud_projection(
    db: AsyncSession,
    *,
    projection_kind: str,
    projection_id: str,
) -> ProjectionResponse:
    projection = await get_projection(
        db,
        projection_kind=projection_kind,
        projection_id=projection_id,
    )
    if projection is None:
        raise CloudApiError("projection_not_found", "Projection not found.", status_code=404)
    return projection_response(projection)
