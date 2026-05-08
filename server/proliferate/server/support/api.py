from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.support.models import (
    SupportMessageRequest,
    SupportMessageResponse,
)
from proliferate.server.support.service import (
    send_support_message,
)

router = APIRouter(prefix="/support", tags=["support"])


@router.post("/messages", response_model=SupportMessageResponse)
async def send_support_message_endpoint(
    body: SupportMessageRequest,
    user: User = Depends(current_active_user),
) -> SupportMessageResponse:
    await send_support_message(
        sender_email=user.email,
        sender_display_name=user.display_name,
        message=body.message,
        context=body.context.model_dump(exclude_none=True) if body.context else None,
    )

    return SupportMessageResponse()
