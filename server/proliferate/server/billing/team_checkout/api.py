from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.billing.models import BillingServiceError
from proliferate.server.billing.team_checkout.models import (
    CurrentTeamCheckoutResponse,
    TeamCheckoutRequest,
    TeamCheckoutResponse,
)
from proliferate.server.billing.team_checkout.service import (
    cancel_current_team_checkout,
    create_team_checkout_session,
    get_current_team_checkout,
)

router = APIRouter(prefix="/team-checkout")


@router.post("", response_model=TeamCheckoutResponse)
async def create_team_checkout(
    request: TeamCheckoutRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session, use_cache=False),
) -> TeamCheckoutResponse:
    try:
        return await create_team_checkout_session(
            db,
            user,
            team_name=request.team_name,
            invite_emails=[str(email) for email in request.invite_emails],
            return_surface=request.return_surface,
        )
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.get("/current", response_model=CurrentTeamCheckoutResponse)
async def get_current_team_checkout_endpoint(
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session, use_cache=False),
) -> CurrentTeamCheckoutResponse:
    try:
        return await get_current_team_checkout(db, user)
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error


@router.post("/{intent_id}/cancel", response_model=CurrentTeamCheckoutResponse)
async def cancel_current_team_checkout_endpoint(
    intent_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session, use_cache=False),
) -> CurrentTeamCheckoutResponse:
    try:
        return await cancel_current_team_checkout(db, user, intent_id)
    except BillingServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error
