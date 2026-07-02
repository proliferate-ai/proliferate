"""HTTP routes for integration management.

- ``router`` (``/integrations``): user-authenticated authentication,
  account removal, and OAuth flow lifecycle + the shared browser callback.
- ``admin_router`` (``/integrations/admin``): org-admin definition/policy
  management (admin authorization is enforced inside the service).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.config import settings
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integrations.models import (
    AdminIntegrationDefinitionResponse,
    AuthenticateIntegrationRequest,
    AuthenticateIntegrationResponse,
    CreateAdminIntegrationDefinitionRequest,
    IntegrationOAuthFlowStatusResponse,
    SetIntegrationEnabledRequest,
)
from proliferate.server.cloud.integrations.oauth_service import OAuthFlowStatus
from proliferate.server.cloud.integrations.pages import (
    build_integration_oauth_web_completion_url,
    make_integration_oauth_callback_page,
)
from proliferate.server.cloud.integrations.service import (
    authenticate_integration,
    cancel_integration_oauth_flow,
    complete_integration_oauth_callback,
    create_admin_integration_definition,
    get_integration_oauth_flow_status,
    list_admin_integration_definitions,
    remove_integration_account,
    set_admin_integration_enabled,
)

router = APIRouter(prefix="/integrations", tags=["integrations"])
admin_router = APIRouter(prefix="/integrations/admin", tags=["integrations-admin"])


def _flow_status_response(status: OAuthFlowStatus) -> IntegrationOAuthFlowStatusResponse:
    flow = status.flow
    return IntegrationOAuthFlowStatusResponse(
        flow_id=flow.id,
        status=flow.status,
        authorization_url=(flow.authorization_url if status.include_authorization_url else None),
        expires_at=flow.expires_at,
        failure_code=flow.failure_code,
        callback_surface=flow.callback_surface,
        final_surface=flow.final_surface,
    )


# --------------------------------------------------------------------------- #
# User routes
# --------------------------------------------------------------------------- #


@router.post("/authentications", response_model=AuthenticateIntegrationResponse)
async def authenticate_integration_endpoint(
    body: AuthenticateIntegrationRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> AuthenticateIntegrationResponse:
    return await authenticate_integration(
        db,
        user_id=user.id,
        definition_id=body.definition_id,
        auth_kind=body.auth_kind,
        api_key=body.api_key,
        settings=body.settings,
        callback_surface=body.callback_surface,
        final_surface=body.final_surface,
        return_path=body.return_path,
    )


@router.delete("/accounts/{account_id}", status_code=204)
async def remove_integration_account_endpoint(
    account_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> Response:
    await remove_integration_account(db, user_id=user.id, account_id=account_id)
    return Response(status_code=204)


@router.get("/oauth/flows/{flow_id}", response_model=IntegrationOAuthFlowStatusResponse)
async def get_integration_oauth_flow_endpoint(
    flow_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> IntegrationOAuthFlowStatusResponse:
    status = await get_integration_oauth_flow_status(db, user_id=user.id, flow_id=flow_id)
    return _flow_status_response(status)


@router.post("/oauth/flows/{flow_id}/cancel", response_model=IntegrationOAuthFlowStatusResponse)
async def cancel_integration_oauth_flow_endpoint(
    flow_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> IntegrationOAuthFlowStatusResponse:
    status = await cancel_integration_oauth_flow(db, user_id=user.id, flow_id=flow_id)
    return _flow_status_response(status)


@router.get(
    "/oauth/callback",
    response_class=HTMLResponse,
    responses={303: {"description": "Redirect to web OAuth completion"}},
)
async def integration_oauth_callback_endpoint(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> Response:
    if not state:
        return make_integration_oauth_callback_page(
            ok=False,
            status="failed",
            failure_code="invalid_state",
        )
    try:
        result = await complete_integration_oauth_callback(
            db,
            state=state,
            code=code,
            provider_error=error,
        )
    except CloudApiError:
        return make_integration_oauth_callback_page(
            ok=False,
            status="failed",
            failure_code="invalid_state",
        )
    if result.callback_surface == "web" and result.return_path:
        return RedirectResponse(
            build_integration_oauth_web_completion_url(
                frontend_base_url=settings.frontend_base_url,
                return_path=result.return_path,
                flow_id=str(result.flow_id) if result.flow_id else "",
                status=result.status,
                final_surface=result.final_surface,
                failure_code=result.failure_code,
            ),
            status_code=303,
        )
    return make_integration_oauth_callback_page(
        ok=result.ok,
        status=result.status,
        flow_id=result.flow_id,
        failure_code=result.failure_code,
    )


# --------------------------------------------------------------------------- #
# Org-admin routes
# --------------------------------------------------------------------------- #


@admin_router.get(
    "/organizations/{organization_id}/definitions",
    response_model=list[AdminIntegrationDefinitionResponse],
)
async def list_admin_integration_definitions_endpoint(
    organization_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[AdminIntegrationDefinitionResponse]:
    return await list_admin_integration_definitions(
        db,
        organization_id=organization_id,
        actor_user_id=user.id,
    )


@admin_router.post(
    "/organizations/{organization_id}/definitions",
    response_model=AdminIntegrationDefinitionResponse,
)
async def create_admin_integration_definition_endpoint(
    organization_id: UUID,
    body: CreateAdminIntegrationDefinitionRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> AdminIntegrationDefinitionResponse:
    return await create_admin_integration_definition(
        db,
        organization_id=organization_id,
        actor_user_id=user.id,
        display_name=body.display_name,
        namespace=body.namespace,
        mcp_url=body.mcp_url,
    )


@admin_router.patch(
    "/organizations/{organization_id}/definitions/{definition_id}/enabled",
    response_model=AdminIntegrationDefinitionResponse,
)
async def set_admin_integration_enabled_endpoint(
    organization_id: UUID,
    definition_id: UUID,
    body: SetIntegrationEnabledRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> AdminIntegrationDefinitionResponse:
    return await set_admin_integration_enabled(
        db,
        organization_id=organization_id,
        definition_id=definition_id,
        actor_user_id=user.id,
        enabled=body.enabled,
    )
