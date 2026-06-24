"""Public organization join landing routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.organizations.service import create_organization_join_landing

router = APIRouter(tags=["organizations"])


@router.get(
    "/join/{organization_id}",
    response_class=HTMLResponse,
    include_in_schema=False,
)
async def organization_join_landing(
    organization_id: UUID,
    db: AsyncSession = Depends(get_async_session),
) -> HTMLResponse:
    html = await create_organization_join_landing(db, organization_id)
    return HTMLResponse(html)
