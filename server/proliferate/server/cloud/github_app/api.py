"""Routes for GitHub App cloud authorization."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.github_app.models import (
    GitHubAppConnectResponse,
    GitHubAppStatusResponse,
)
from proliferate.server.cloud.github_app.service import (
    complete_github_app_callback,
    create_github_app_connect_url,
    get_github_app_status,
)

router = APIRouter(prefix="/github-app", tags=["github-app"])
callback_router = APIRouter(tags=["github-app"])


@router.get("/connect", response_model=GitHubAppConnectResponse)
async def github_app_connect_endpoint(
    return_to: str | None = Query(default=None, alias="returnTo"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> GitHubAppConnectResponse:
    try:
        return await create_github_app_connect_url(db, user=user, return_to=return_to)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("/status", response_model=GitHubAppStatusResponse)
async def github_app_status_endpoint(
    git_owner: str | None = Query(default=None, alias="gitOwner"),
    git_repo_name: str | None = Query(default=None, alias="gitRepoName"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> GitHubAppStatusResponse:
    try:
        return await get_github_app_status(
            db,
            user=user,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@callback_router.get("/github-app/callback")
async def github_app_callback_endpoint(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_async_session),
) -> RedirectResponse:
    try:
        redirect_url = await complete_github_app_callback(db, code=code, state=state)
    except CloudApiError as error:
        raise_cloud_error(error)
    return RedirectResponse(redirect_url, status_code=302)
