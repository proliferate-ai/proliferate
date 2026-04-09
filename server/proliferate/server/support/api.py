from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.support.models import (
    SupportMessageRequest,
    SupportMessageResponse,
)
from proliferate.server.support.service import (
    SupportServiceError,
    send_support_message,
)

router = APIRouter(prefix="/support", tags=["support"])


@router.post("/messages", response_model=SupportMessageResponse)
async def send_support_message_endpoint(
    body: SupportMessageRequest,
    user: User = Depends(current_active_user),
) -> SupportMessageResponse:
    try:
        await send_support_message(
            user,
            message=body.message,
            context=body.context.model_dump(exclude_none=True) if body.context else None,
        )
    except SupportServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error

    return SupportMessageResponse()
