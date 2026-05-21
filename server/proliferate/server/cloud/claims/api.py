"""Cloud workspace claim API routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.claims.models import (
    ClaimWorkspaceRequest,
    ClaimWorkspaceResponse,
    DirectAccessTokenRequest,
    DirectAccessTokenResponse,
    RevokeClaimTokenResponse,
)
from proliferate.server.cloud.claims.service import (
    claim_workspace,
    issue_direct_access_token,
    refresh_direct_access_token,
    revoke_direct_access_token,
)
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error

router = APIRouter()


@router.post("/workspaces/{cloud_workspace_id}/claim", response_model=ClaimWorkspaceResponse)
async def claim_workspace_endpoint(
    cloud_workspace_id: UUID,
    body: ClaimWorkspaceRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> ClaimWorkspaceResponse:
    try:
        return await claim_workspace(
            db,
            user=user,
            cloud_workspace_id=cloud_workspace_id,
            source_kind=body.source_kind,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post(
    "/workspaces/{cloud_workspace_id}/direct-access-token",
    response_model=DirectAccessTokenResponse,
)
async def issue_direct_access_token_endpoint(
    cloud_workspace_id: UUID,
    body: DirectAccessTokenRequest,
    x_client_kind: str | None = Header(default=None, alias="X-Client-Kind"),
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> DirectAccessTokenResponse:
    try:
        return await issue_direct_access_token(
            db,
            user=user,
            cloud_workspace_id=cloud_workspace_id,
            body=body,
            client_kind=x_client_kind,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post(
    "/workspaces/{cloud_workspace_id}/direct-access-token/refresh",
    response_model=DirectAccessTokenResponse,
)
async def refresh_direct_access_token_endpoint(
    cloud_workspace_id: UUID,
    body: DirectAccessTokenRequest,
    x_client_kind: str | None = Header(default=None, alias="X-Client-Kind"),
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> DirectAccessTokenResponse:
    try:
        return await refresh_direct_access_token(
            db,
            user=user,
            cloud_workspace_id=cloud_workspace_id,
            body=body,
            client_kind=x_client_kind,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.delete(
    "/workspaces/{cloud_workspace_id}/direct-access-tokens/{token_id}",
    response_model=RevokeClaimTokenResponse,
)
async def revoke_direct_access_token_endpoint(
    cloud_workspace_id: UUID,
    token_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> RevokeClaimTokenResponse:
    try:
        return await revoke_direct_access_token(
            db,
            user=user,
            cloud_workspace_id=cloud_workspace_id,
            token_id=token_id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
