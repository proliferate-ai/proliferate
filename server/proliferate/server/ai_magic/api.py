from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_product_user
from proliferate.db.models.auth import User
from proliferate.server.ai_magic.models import (
    GenerateGitPublishRequest,
    GenerateGitPublishResponse,
    GenerateSessionTitleRequest,
    GenerateSessionTitleResponse,
    GenerateWorkspaceNameRequest,
    GenerateWorkspaceNameResponse,
)
from proliferate.server.ai_magic.service import (
    generate_git_publish,
    generate_session_title,
    generate_workspace_name,
)

router = APIRouter(prefix="/ai_magic", tags=["ai_magic"])


@router.post("/session-titles/generate", response_model=GenerateSessionTitleResponse)
async def generate_session_title_endpoint(
    body: GenerateSessionTitleRequest,
    user: User = Depends(current_product_user),
) -> GenerateSessionTitleResponse:
    title = await generate_session_title(user.id, prompt_text=body.prompt_text)
    return GenerateSessionTitleResponse(title=title)


@router.post("/workspace-names/generate", response_model=GenerateWorkspaceNameResponse)
async def generate_workspace_name_endpoint(
    body: GenerateWorkspaceNameRequest,
    user: User = Depends(current_product_user),
) -> GenerateWorkspaceNameResponse:
    name = await generate_workspace_name(user.id, prompt_text=body.prompt_text)
    return GenerateWorkspaceNameResponse(name=name)


@router.post("/git-publish/generate", response_model=GenerateGitPublishResponse, response_model_by_alias=True)
async def generate_git_publish_endpoint(
    body: GenerateGitPublishRequest,
    user: User = Depends(current_product_user),
) -> GenerateGitPublishResponse:
    result = await generate_git_publish(
        user.id,
        prompt_text=body.prompt_text,
        mode=body.mode,
        instructions=body.instructions,
    )
    return GenerateGitPublishResponse(
        commit_message=result["commit_message"],
        pr_title=result["pr_title"],
        pr_body=result["pr_body"],
    )
