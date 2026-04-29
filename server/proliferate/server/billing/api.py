from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.billing.models import (
    BillingOverview,
    BillingServiceError,
    BillingUrlResponse,
    CloudPlanInfo,
    OverageSettingsRequest,
    OverageSettingsResponse,
    PlanInfo,
    StripeWebhookAck,
)
from proliferate.server.billing.service import (
    create_cloud_checkout_session,
    create_customer_portal_session,
    create_refill_checkout_session,
    get_billing_overview,
    get_cloud_plan,
    get_current_plan,
    update_overage_settings,
)
from proliferate.server.billing.stripe_webhooks import handle_stripe_webhook

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


@router.post("/cloud-checkout", response_model=BillingUrlResponse)
async def create_cloud_checkout(
    user: User = Depends(current_active_user),
) -> BillingUrlResponse:
    try:
        return await create_cloud_checkout_session(user)
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.post("/customer-portal", response_model=BillingUrlResponse)
async def create_customer_portal(
    user: User = Depends(current_active_user),
) -> BillingUrlResponse:
    try:
        return await create_customer_portal_session(user)
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.post("/refill-checkout", response_model=BillingUrlResponse)
async def create_refill_checkout(
    user: User = Depends(current_active_user),
) -> BillingUrlResponse:
    try:
        return await create_refill_checkout_session(user)
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.post("/overage-settings", response_model=OverageSettingsResponse)
async def update_overage_settings_endpoint(
    request: OverageSettingsRequest,
    user: User = Depends(current_active_user),
) -> OverageSettingsResponse:
    return await update_overage_settings(user, enabled=request.enabled)


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
