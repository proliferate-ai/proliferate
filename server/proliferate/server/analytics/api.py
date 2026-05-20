from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import optional_current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.analytics.models import (
    AnalyticsAcceptedResponse,
    ClientDailyActivityRequest,
)
from proliferate.server.analytics.service import record_client_daily_activity

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.post(
    "/client-daily-activity",
    response_model=AnalyticsAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def record_client_daily_activity_endpoint(
    body: ClientDailyActivityRequest,
    user: User | None = Depends(optional_current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> AnalyticsAcceptedResponse:
    await record_client_daily_activity(
        db,
        user_id=user.id if user is not None else None,
        body=body,
    )
    return AnalyticsAcceptedResponse()
