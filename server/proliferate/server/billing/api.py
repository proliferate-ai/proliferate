from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import OwnerSelection
from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.permissions import OwnerContext, current_owner_context
from proliferate.server.billing.checkout import (
    create_cloud_checkout_session,
    create_customer_portal_session,
    create_refill_checkout_session,
    update_overage_settings,
)
from proliferate.server.billing.models import (
    BillingOverview,
    BillingOwnerSelection,
    BillingServiceError,
    BillingUrlResponse,
    CloudPlanInfo,
    LlmBalance,
    OverageSettingsRequest,
    OverageSettingsResponse,
    PlanInfo,
    StripeWebhookAck,
    UsageSummary,
    UsageTimeseries,
)
from proliferate.server.billing.overview import (
    get_billing_overview_for_context,
    get_cloud_plan_for_context,
    get_current_plan,
)
from proliferate.server.billing.stripe_webhooks import handle_stripe_webhook
from proliferate.server.billing.team_checkout import api as team_checkout_api
from proliferate.server.billing.usage import (
    get_llm_balance,
    get_usage_summary,
    get_usage_timeseries,
)

router = APIRouter(prefix="/billing", tags=["billing"])
router.include_router(team_checkout_api.router)


@router.get("/plan", response_model=PlanInfo)
async def get_plan(
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> PlanInfo:
    try:
        return await get_current_plan(db, user.id)
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.get("/cloud-plan", response_model=CloudPlanInfo)
async def get_cloud_plan_endpoint(
    owner_context: OwnerContext = Depends(current_owner_context),
    db: AsyncSession = Depends(get_async_session),
) -> CloudPlanInfo:
    try:
        return await get_cloud_plan_for_context(db, owner_context)
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.get("/overview", response_model=BillingOverview)
async def get_overview(
    owner_context: OwnerContext = Depends(current_owner_context),
    db: AsyncSession = Depends(get_async_session),
) -> BillingOverview:
    try:
        return await get_billing_overview_for_context(db, owner_context)
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.get("/usage/summary", response_model=UsageSummary)
async def get_usage_summary_endpoint(
    user: User = Depends(current_product_user),
    owner_context: OwnerContext = Depends(current_owner_context),
    db: AsyncSession = Depends(get_async_session),
) -> UsageSummary:
    try:
        return await get_usage_summary(db, owner_context, user_id=user.id)
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.get("/usage/timeseries", response_model=UsageTimeseries)
async def get_usage_timeseries_endpoint(
    granularity: Literal["day", "week", "month"] = Query(default="day"),
    days: int = Query(default=30),
    kind: Literal["compute", "llm", "all"] = Query(default="all"),
    owner_context: OwnerContext = Depends(current_owner_context),
    db: AsyncSession = Depends(get_async_session),
) -> UsageTimeseries:
    try:
        return await get_usage_timeseries(
            db,
            billing_subject_id=owner_context.billing_subject_id,
            granularity=granularity,
            days=days,
            kind=kind,
        )
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.get("/llm-balance", response_model=LlmBalance)
async def get_llm_balance_endpoint(
    owner_context: OwnerContext = Depends(current_owner_context),
    db: AsyncSession = Depends(get_async_session),
) -> LlmBalance:
    try:
        return await get_llm_balance(db, owner_context)
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.post("/cloud-checkout", response_model=BillingUrlResponse)
async def create_cloud_checkout(
    request: BillingOwnerSelection | None = None,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session, use_cache=False),
) -> BillingUrlResponse:
    try:
        return await create_cloud_checkout_session(
            db,
            user,
            _owner_selection_from_body(request),
            return_surface=request.return_surface if request else "web",
        )
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.post("/customer-portal", response_model=BillingUrlResponse)
async def create_customer_portal(
    request: BillingOwnerSelection | None = None,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session, use_cache=False),
) -> BillingUrlResponse:
    try:
        return await create_customer_portal_session(
            db,
            user,
            _owner_selection_from_body(request),
            return_surface=request.return_surface if request else "web",
        )
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.post("/refill-checkout", response_model=BillingUrlResponse)
async def create_refill_checkout(
    request: BillingOwnerSelection | None = None,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session, use_cache=False),
) -> BillingUrlResponse:
    try:
        return await create_refill_checkout_session(
            db,
            user,
            _owner_selection_from_body(request),
            return_surface=request.return_surface if request else "web",
        )
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.post("/overage-settings", response_model=OverageSettingsResponse)
async def update_overage_settings_endpoint(
    request: OverageSettingsRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> OverageSettingsResponse:
    try:
        return await update_overage_settings(
            db,
            user,
            enabled=request.enabled,
            cap_cents_per_seat=request.cap_cents_per_seat,
            owner_selection=OwnerSelection(
                owner_scope=request.owner_scope,
                organization_id=request.organization_id,
            ),
        )
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.post("/webhooks/stripe", response_model=StripeWebhookAck)
async def stripe_webhook_endpoint(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
) -> StripeWebhookAck:
    try:
        return await handle_stripe_webhook(
            payload=await request.body(),
            signature_header=stripe_signature,
        )
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


def _owner_selection_from_body(request: BillingOwnerSelection | None) -> OwnerSelection:
    if request is None:
        return OwnerSelection()
    return OwnerSelection(
        owner_scope=request.owner_scope,
        organization_id=request.organization_id,
    )
