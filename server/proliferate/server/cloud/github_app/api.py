"""Routes for GitHub App cloud authorization."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.permissions import CurrentOrgUser, current_path_org_admin, current_path_org_member
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.github_app.models import (
    GitHubAppInstallationStartResponse,
    GitHubAppInstallationStatusResponse,
    GitHubAppUserAuthorizationStartResponse,
    GitHubAppUserAuthorizationStatusResponse,
    GitHubRepoAuthorityResponse,
)
from proliferate.server.cloud.github_app.service import (
    complete_github_app_installation_callback,
    complete_github_app_user_authorization_callback,
    create_github_app_installation_url,
    create_github_app_user_authorization_url,
    get_github_app_installation_status,
    get_github_app_user_authorization_status,
    get_github_repo_authority_status,
    list_github_app_accessible_repositories,
)
from proliferate.server.cloud.repos.models import (
    CloudGitRepositoriesResponse,
    cloud_git_repositories_payload,
)
from proliferate.server.cloud.repos.service import (
    DEFAULT_REPO_AFFILIATION,
    DEFAULT_REPO_VISIBILITY,
)

router = APIRouter(prefix="/github-app", tags=["github-app"])
organization_router = APIRouter(
    prefix="/organizations/{organization_id}/github-app",
    tags=["github-app"],
)
callback_router = APIRouter(prefix="/github-app", tags=["github-app"])
setup_callback_router = APIRouter(prefix="/integrations/github", tags=["github-app"])


@router.get(
    "/user-authorization/start",
    response_model=GitHubAppUserAuthorizationStartResponse,
)
async def start_github_app_user_authorization_endpoint(
    return_to: str | None = Query(default=None, alias="returnTo"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> GitHubAppUserAuthorizationStartResponse:
    try:
        return await create_github_app_user_authorization_url(
            db,
            user=user,
            return_to=return_to,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get(
    "/user-authorization",
    response_model=GitHubAppUserAuthorizationStatusResponse,
)
async def github_app_user_authorization_status_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> GitHubAppUserAuthorizationStatusResponse:
    return await get_github_app_user_authorization_status(db, user=user)


@router.get(
    "/accessible-repos",
    response_model=CloudGitRepositoriesResponse,
)
async def list_github_app_accessible_repositories_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
    query: str | None = None,
    cursor: str | None = None,
    limit: int = 50,
    affiliation: str = DEFAULT_REPO_AFFILIATION,
    visibility: str = DEFAULT_REPO_VISIBILITY,
) -> CloudGitRepositoriesResponse:
    try:
        page = await list_github_app_accessible_repositories(
            db,
            user=user,
            query=query,
            cursor=cursor,
            limit=limit,
            affiliation=affiliation,
            visibility=visibility,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_git_repositories_payload(page)


@router.get(
    "/repos/{git_owner}/{git_repo_name}/authority",
    response_model=GitHubRepoAuthorityResponse,
)
async def github_app_repo_authority_endpoint(
    git_owner: str,
    git_repo_name: str,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> GitHubRepoAuthorityResponse:
    return await get_github_repo_authority_status(
        db,
        user=user,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )


@organization_router.get(
    "/installation/start",
    response_model=GitHubAppInstallationStartResponse,
)
async def start_github_app_installation_endpoint(
    return_to: str | None = Query(default=None, alias="returnTo"),
    db: AsyncSession = Depends(get_async_session),
    org_user: CurrentOrgUser = Depends(current_path_org_admin),
) -> GitHubAppInstallationStartResponse:
    try:
        return await create_github_app_installation_url(
            db,
            org_user=org_user,
            return_to=return_to,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@organization_router.get(
    "/installation",
    response_model=GitHubAppInstallationStatusResponse,
)
async def github_app_installation_status_endpoint(
    db: AsyncSession = Depends(get_async_session),
    org_user: CurrentOrgUser = Depends(current_path_org_member),
) -> GitHubAppInstallationStatusResponse:
    return await get_github_app_installation_status(db, org_user=org_user)


@callback_router.get("/user-authorization/callback")
async def github_app_user_authorization_callback_endpoint(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_async_session),
) -> RedirectResponse:
    try:
        redirect_url = await complete_github_app_user_authorization_callback(
            db,
            code=code,
            state=state,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return RedirectResponse(redirect_url, status_code=302)


@callback_router.get("/installation/callback")
async def github_app_installation_callback_endpoint(
    installation_id: str | None = Query(default=None),
    setup_action: str | None = Query(default=None),
    state: str = Query(...),
    db: AsyncSession = Depends(get_async_session),
) -> RedirectResponse:
    try:
        redirect_url = await complete_github_app_installation_callback(
            db,
            installation_id=installation_id,
            setup_action=setup_action,
            state=state,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return RedirectResponse(redirect_url, status_code=302)


@setup_callback_router.get("/callback")
async def github_app_setup_callback_endpoint(
    installation_id: str | None = Query(default=None),
    setup_action: str | None = Query(default=None),
    state: str = Query(...),
    db: AsyncSession = Depends(get_async_session),
) -> RedirectResponse:
    try:
        redirect_url = await complete_github_app_installation_callback(
            db,
            installation_id=installation_id,
            setup_action=setup_action,
            state=state,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return RedirectResponse(redirect_url, status_code=302)
