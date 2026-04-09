from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.ai_magic.models import (
    GenerateSessionTitleRequest,
    GenerateSessionTitleResponse,
)
from proliferate.server.ai_magic.service import AiMagicServiceError, generate_session_title

router = APIRouter(prefix="/ai_magic", tags=["ai_magic"])


@router.post("/session-titles/generate", response_model=GenerateSessionTitleResponse)
async def generate_session_title_endpoint(
    body: GenerateSessionTitleRequest,
    user: User = Depends(current_active_user),
) -> GenerateSessionTitleResponse:
    try:
        title = await generate_session_title(user, prompt_text=body.prompt_text)
    except AiMagicServiceError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": error.message},
        ) from error

    return GenerateSessionTitleResponse(title=title)
