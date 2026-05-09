from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.ai_magic.models import (
    GenerateSessionTitleRequest,
    GenerateSessionTitleResponse,
)
from proliferate.server.ai_magic.service import generate_session_title

router = APIRouter(prefix="/ai_magic", tags=["ai_magic"])


@router.post("/session-titles/generate", response_model=GenerateSessionTitleResponse)
async def generate_session_title_endpoint(
    body: GenerateSessionTitleRequest,
    user: User = Depends(current_active_user),
) -> GenerateSessionTitleResponse:
    title = await generate_session_title(user.id, prompt_text=body.prompt_text)
    return GenerateSessionTitleResponse(title=title)
