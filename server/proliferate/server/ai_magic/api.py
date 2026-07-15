from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.constants.cloud import GitProvider
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.db.store.repositories import get_repo_config_for_user
from proliferate.server.ai_magic.models import (
    GenerateCommitMessageRequest,
    GenerateCommitMessageResponse,
    GenerateSessionTitleRequest,
    GenerateSessionTitleResponse,
    GenerateWorkspaceNameRequest,
    GenerateWorkspaceNameResponse,
)
from proliferate.server.ai_magic.service import (
    generate_commit_message,
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


@router.post("/commit-messages/generate", response_model=GenerateCommitMessageResponse)
async def generate_commit_message_endpoint(
    body: GenerateCommitMessageRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> GenerateCommitMessageResponse:
    instructions: str | None = None
    if body.git_owner and body.git_repo_name:
        repo_config = await get_repo_config_for_user(
            db,
            user_id=user.id,
            git_provider=GitProvider.github.value,
            git_owner=body.git_owner,
            git_repo_name=body.git_repo_name,
        )
        if repo_config is not None:
            instructions = repo_config.commit_instructions

    message = await generate_commit_message(
        user.id,
        diff_text=body.diff_text,
        instructions=instructions,
        branch_name=body.branch_name,
    )
    return GenerateCommitMessageResponse(message=message)
