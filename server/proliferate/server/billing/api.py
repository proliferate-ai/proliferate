from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.billing.models import BillingOverview, CloudPlanInfo, PlanInfo
from proliferate.server.billing.service import (
    get_billing_overview,
    get_cloud_plan,
    get_current_plan,
)

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/plan", response_model=PlanInfo)
async def get_plan(
    user: User = Depends(current_active_user),
) -> PlanInfo:
    return await get_current_plan(user.id)


@router.get("/cloud-plan", response_model=CloudPlanInfo)
async def get_cloud_plan_endpoint(
    user: User = Depends(current_active_user),
) -> CloudPlanInfo:
    return await get_cloud_plan(user.id)


@router.get("/overview", response_model=BillingOverview)
async def get_overview(
    user: User = Depends(current_active_user),
) -> BillingOverview:
    return await get_billing_overview(user.id)
