"""Organization SSO administration routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.organizations.sso.models import (
    OrganizationSsoConnectionRequest,
    OrganizationSsoConnectionResponse,
    OrganizationSsoConnectionsResponse,
    OrganizationSsoConnectionTestResponse,
    OrganizationSsoConnectionUpdateRequest,
    SsoConnectionRecord,
    connection_response,
)
from proliferate.server.organizations.sso.service import (
    list_organization_sso_connections,
    organization_sso_urls,
)
from proliferate.server.organizations.sso.transactions import (
    create_organization_sso_connection_and_commit,
    delete_organization_sso_connection_and_commit,
    disable_organization_sso_connection_and_commit,
    enable_organization_sso_connection_and_commit,
    test_organization_sso_connection_and_commit,
    update_organization_sso_connection_and_commit,
)

router = APIRouter(prefix="/organizations/{organization_id}/sso", tags=["organizations"])


@router.get("/connections", response_model=OrganizationSsoConnectionsResponse)
async def list_organization_sso_connections_endpoint(
    organization_id: UUID,
    request: Request,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationSsoConnectionsResponse:
    records = await list_organization_sso_connections(
        db,
        actor_user=user,
        organization_id=organization_id,
    )
    return OrganizationSsoConnectionsResponse(
        connections=[_response(request, record) for record in records],
    )


@router.post(
    "/connections",
    response_model=OrganizationSsoConnectionResponse,
    status_code=201,
)
async def create_organization_sso_connection_endpoint(
    organization_id: UUID,
    body: OrganizationSsoConnectionRequest,
    request: Request,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationSsoConnectionResponse:
    record = await create_organization_sso_connection_and_commit(
        db,
        actor_user=user,
        organization_id=organization_id,
        body=body,
    )
    return _response(request, record)


@router.patch(
    "/connections/{connection_id}",
    response_model=OrganizationSsoConnectionResponse,
)
async def update_organization_sso_connection_endpoint(
    organization_id: UUID,
    connection_id: UUID,
    body: OrganizationSsoConnectionUpdateRequest,
    request: Request,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationSsoConnectionResponse:
    record = await update_organization_sso_connection_and_commit(
        db,
        actor_user=user,
        organization_id=organization_id,
        connection_id=connection_id,
        body=body,
    )
    return _response(request, record)


@router.post(
    "/connections/{connection_id}/test",
    response_model=OrganizationSsoConnectionTestResponse,
)
async def test_organization_sso_connection_endpoint(
    organization_id: UUID,
    connection_id: UUID,
    request: Request,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationSsoConnectionTestResponse:
    record = await test_organization_sso_connection_and_commit(
        db,
        actor_user=user,
        organization_id=organization_id,
        connection_id=connection_id,
    )
    return OrganizationSsoConnectionTestResponse(ok=True, connection=_response(request, record))


@router.post(
    "/connections/{connection_id}/enable",
    response_model=OrganizationSsoConnectionResponse,
)
async def enable_organization_sso_connection_endpoint(
    organization_id: UUID,
    connection_id: UUID,
    request: Request,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationSsoConnectionResponse:
    record = await enable_organization_sso_connection_and_commit(
        db,
        actor_user=user,
        organization_id=organization_id,
        connection_id=connection_id,
    )
    return _response(request, record)


@router.post(
    "/connections/{connection_id}/disable",
    response_model=OrganizationSsoConnectionResponse,
)
async def disable_organization_sso_connection_endpoint(
    organization_id: UUID,
    connection_id: UUID,
    request: Request,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationSsoConnectionResponse:
    record = await disable_organization_sso_connection_and_commit(
        db,
        actor_user=user,
        organization_id=organization_id,
        connection_id=connection_id,
    )
    return _response(request, record)


@router.delete(
    "/connections/{connection_id}",
    response_model=OrganizationSsoConnectionResponse,
)
async def delete_organization_sso_connection_endpoint(
    organization_id: UUID,
    connection_id: UUID,
    request: Request,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationSsoConnectionResponse:
    record = await delete_organization_sso_connection_and_commit(
        db,
        actor_user=user,
        organization_id=organization_id,
        connection_id=connection_id,
    )
    return _response(request, record)


def _response(request: Request, record: SsoConnectionRecord) -> OrganizationSsoConnectionResponse:
    oidc_redirect_uri, saml_acs_url, saml_entity_id, saml_metadata_url = organization_sso_urls(
        request,
        record.id,
    )
    return connection_response(
        record,
        oidc_redirect_uri=oidc_redirect_uri,
        saml_acs_url=saml_acs_url,
        saml_entity_id=saml_entity_id,
        saml_metadata_url=saml_metadata_url,
    )
