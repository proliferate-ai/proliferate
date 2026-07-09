"""Organization usage visibility + budget-limit administration routes."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.permissions import CurrentOrgUser, current_path_org_admin
from proliferate.server.organizations.usage.models import (
    BudgetLimitsResponse,
    OrgUsageByUserResponse,
    OrgUserUsageTimeseriesResponse,
    PutBudgetLimitsRequest,
)
from proliferate.server.organizations.usage.service import (
    get_usage_by_user,
    get_user_usage_timeseries,
    list_limits,
    replace_limits,
)

router = APIRouter(prefix="/organizations/{organization_id}", tags=["organizations"])


@router.get("/usage/by-user", response_model=OrgUsageByUserResponse)
async def get_usage_by_user_endpoint(
    days: int = Query(default=30),
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    db: AsyncSession = Depends(get_async_session),
) -> OrgUsageByUserResponse:
    return await get_usage_by_user(db, org_admin.organization_id, days=days)


@router.get(
    "/usage/users/{user_id}/timeseries",
    response_model=OrgUserUsageTimeseriesResponse,
)
async def get_user_usage_timeseries_endpoint(
    user_id: UUID,
    granularity: Literal["day", "week", "month"] = Query(default="day"),
    days: int = Query(default=30),
    kind: Literal["compute", "llm", "all"] = Query(default="all"),
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    db: AsyncSession = Depends(get_async_session),
) -> OrgUserUsageTimeseriesResponse:
    return await get_user_usage_timeseries(
        db,
        org_admin.organization_id,
        user_id,
        granularity=granularity,
        days=days,
        kind=kind,
    )


@router.get("/limits", response_model=BudgetLimitsResponse)
async def get_limits_endpoint(
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    db: AsyncSession = Depends(get_async_session),
) -> BudgetLimitsResponse:
    return await list_limits(db, org_admin.organization_id)


@router.put("/limits", response_model=BudgetLimitsResponse)
async def put_limits_endpoint(
    body: PutBudgetLimitsRequest,
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    db: AsyncSession = Depends(get_async_session, use_cache=False),
) -> BudgetLimitsResponse:
    return await replace_limits(db, org_admin.organization_id, body)
