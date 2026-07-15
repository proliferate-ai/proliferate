from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.support.feed.access import require_support_feed_key
from proliferate.server.support.feed.models import SupportFeedPage
from proliferate.server.support.feed.service import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    MIN_LIMIT,
    get_support_report_feed,
)

# Logical private route. The hosted product mounts server routes beneath /api,
# so this is reached externally as /api/internal/support/reports. It is not a
# public /v1 route and must not be replaced by /v1/support/reports/poll.
router = APIRouter(prefix="/internal/support", tags=["support-feed"])


@router.get(
    "/reports",
    response_model=SupportFeedPage,
    dependencies=[Depends(require_support_feed_key)],
)
async def list_support_report_feed(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=DEFAULT_LIMIT, ge=MIN_LIMIT, le=MAX_LIMIT),
    db: AsyncSession = Depends(get_async_session),
) -> SupportFeedPage:
    return await get_support_report_feed(db=db, cursor=cursor, limit=limit)
