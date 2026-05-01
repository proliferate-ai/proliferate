from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.billing.models import (
    BillingOverview,
    BillingOwnerSelection,
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
    get_billing_overview_for_owner,
    get_cloud_plan,
    get_cloud_plan_for_owner,
    get_current_plan,
    update_overage_settings,
)
from proliferate.server.billing.stripe_webhooks import handle_stripe_webhook
from proliferate.server.organizations.service import OwnerSelection

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/plan", response_model=PlanInfo)
async def get_plan(
    user: User = Depends(current_active_user),
) -> PlanInfo:
    return await get_current_plan(user.id)


@router.get("/cloud-plan", response_model=CloudPlanInfo)
async def get_cloud_plan_endpoint(
    owner_scope: Literal["personal", "organization"] = Query("personal", alias="ownerScope"),
    organization_id: UUID | None = Query(default=None, alias="organizationId"),
    user: User = Depends(current_active_user),
) -> CloudPlanInfo:
    try:
        if owner_scope == "personal" and organization_id is None:
            return await get_cloud_plan(user.id)
        return await get_cloud_plan_for_owner(
            user,
            OwnerSelection(owner_scope=owner_scope, organization_id=organization_id),
        )
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.get("/overview", response_model=BillingOverview)
async def get_overview(
    owner_scope: Literal["personal", "organization"] = Query("personal", alias="ownerScope"),
    organization_id: UUID | None = Query(default=None, alias="organizationId"),
    user: User = Depends(current_active_user),
) -> BillingOverview:
    try:
        if owner_scope == "personal" and organization_id is None:
            return await get_billing_overview(user.id)
        return await get_billing_overview_for_owner(
            user,
            OwnerSelection(owner_scope=owner_scope, organization_id=organization_id),
        )
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.post("/cloud-checkout", response_model=BillingUrlResponse)
async def create_cloud_checkout(
    request: BillingOwnerSelection | None = None,
    user: User = Depends(current_active_user),
) -> BillingUrlResponse:
    try:
        return await create_cloud_checkout_session(
            user,
            _owner_selection_from_body(request),
        )
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.post("/customer-portal", response_model=BillingUrlResponse)
async def create_customer_portal(
    request: BillingOwnerSelection | None = None,
    user: User = Depends(current_active_user),
) -> BillingUrlResponse:
    try:
        return await create_customer_portal_session(
            user,
            _owner_selection_from_body(request),
        )
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.post("/refill-checkout", response_model=BillingUrlResponse)
async def create_refill_checkout(
    request: BillingOwnerSelection | None = None,
    user: User = Depends(current_active_user),
) -> BillingUrlResponse:
    try:
        return await create_refill_checkout_session(
            user,
            _owner_selection_from_body(request),
        )
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
    try:
        return await update_overage_settings(
            user,
            enabled=request.enabled,
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
