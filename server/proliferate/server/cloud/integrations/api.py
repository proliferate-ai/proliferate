from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.config import settings
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integrations.models import (
    CreateIntegrationAccountRequest,
    CreateIntegrationDefinitionRequest,
    IntegrationAccountResponse,
    IntegrationAvailabilityItem,
    IntegrationClientMetadataDocument,
    IntegrationDefinitionResponse,
    IntegrationOAuthFlowStatusResponse,
    IntegrationToolMetadata,
    PatchIntegrationAccountRequest,
    StartIntegrationOAuthFlowRequest,
    StartIntegrationOAuthFlowResponse,
)
from proliferate.server.cloud.integrations.service import (
    cancel_integration_oauth_flow,
    client_metadata_document,
    complete_integration_oauth_callback,
    create_org_custom_definition,
    create_personal_integration_account,
    delete_integration_account,
    get_integration_oauth_flow_status,
    list_integration_accounts,
    list_integration_availability,
    list_integration_definitions,
    list_integration_tool_metadata,
    patch_integration_account,
    start_integration_oauth_flow,
)
from proliferate.server.cloud.mcp_oauth.domain.flow_rules import build_oauth_web_completion_url
from proliferate.server.cloud.mcp_oauth.models import oauth_flow_status_payload
from proliferate.server.cloud.mcp_oauth.pages import make_mcp_oauth_callback_page

router = APIRouter(prefix="/integrations")


@router.get("/definitions", response_model=list[IntegrationDefinitionResponse])
async def list_integration_definitions_endpoint(
    organization_id: UUID | None = Query(default=None, alias="organizationId"),
    _user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[IntegrationDefinitionResponse]:
    return await list_integration_definitions(db, organization_id=organization_id)


@router.post("/definitions", response_model=IntegrationDefinitionResponse)
async def create_integration_definition_endpoint(
    body: CreateIntegrationDefinitionRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> IntegrationDefinitionResponse:
    return await create_org_custom_definition(
        db,
        organization_id=UUID(body.organization_id),
        user_id=user.id,
        display_name=body.display_name,
        namespace=body.namespace,
        mcp_url=body.mcp_url,
    )


@router.get(
    "/definitions/{definition_id}/client-metadata",
    response_model=IntegrationClientMetadataDocument,
)
async def integration_client_metadata_document_endpoint(
    definition_id: UUID,
) -> dict[str, object]:
    return client_metadata_document(definition_id=definition_id)


@router.get("/accounts", response_model=list[IntegrationAccountResponse])
async def list_integration_accounts_endpoint(
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[IntegrationAccountResponse]:
    return await list_integration_accounts(db, user_id=user.id)


@router.post("/accounts", response_model=IntegrationAccountResponse)
async def create_integration_account_endpoint(
    body: CreateIntegrationAccountRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> IntegrationAccountResponse:
    return await create_personal_integration_account(
        db,
        user_id=user.id,
        definition_id=UUID(body.definition_id),
        auth_kind=body.auth_kind,
        api_key=body.api_key,
        settings_payload=body.settings,
    )


@router.patch("/accounts/{account_id}", response_model=IntegrationAccountResponse)
async def patch_integration_account_endpoint(
    account_id: UUID,
    body: PatchIntegrationAccountRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> IntegrationAccountResponse:
    return await patch_integration_account(
        db,
        user_id=user.id,
        account_id=account_id,
        enabled=body.enabled,
        api_key=body.api_key,
        settings_payload=body.settings,
    )


@router.delete("/accounts/{account_id}", status_code=204)
async def delete_integration_account_endpoint(
    account_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    await delete_integration_account(db, user_id=user.id, account_id=account_id)


@router.post(
    "/accounts/{account_id}/oauth/start",
    response_model=StartIntegrationOAuthFlowResponse,
)
async def start_integration_oauth_flow_endpoint(
    account_id: UUID,
    body: StartIntegrationOAuthFlowRequest | None = Body(default=None),
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> StartIntegrationOAuthFlowResponse:
    flow = await start_integration_oauth_flow(
        db,
        user_id=user.id,
        account_id=account_id,
        callback_surface=body.callback_surface if body else None,
        final_surface=body.final_surface if body else None,
        return_path=body.return_path if body else None,
        client_strategy=body.client_strategy if body else None,
    )
    return StartIntegrationOAuthFlowResponse(
        flowId=str(flow.id),
        status=flow.status,
        authorizationUrl=flow.authorization_url,
        expiresAt=flow.expires_at,
    )


@router.get("/oauth/flows/{flow_id}", response_model=IntegrationOAuthFlowStatusResponse)
async def get_integration_oauth_flow_endpoint(
    flow_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> IntegrationOAuthFlowStatusResponse:
    status = await get_integration_oauth_flow_status(db, user_id=user.id, flow_id=flow_id)
    payload = oauth_flow_status_payload(
        status.flow,
        include_authorization_url=status.include_authorization_url,
    )
    return IntegrationOAuthFlowStatusResponse(**payload.model_dump(mode="json", by_alias=True))


@router.post("/oauth/flows/{flow_id}/cancel", response_model=IntegrationOAuthFlowStatusResponse)
async def cancel_integration_oauth_flow_endpoint(
    flow_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> IntegrationOAuthFlowStatusResponse:
    status = await cancel_integration_oauth_flow(db, user_id=user.id, flow_id=flow_id)
    payload = oauth_flow_status_payload(status.flow, include_authorization_url=False)
    return IntegrationOAuthFlowStatusResponse(**payload.model_dump(mode="json", by_alias=True))


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
        return make_mcp_oauth_callback_page(
            ok=False, status="failed", failure_code="invalid_state"
        )
    try:
        result = await complete_integration_oauth_callback(
            db,
            state=state,
            code=code,
            provider_error=error,
        )
    except CloudApiError:
        return make_mcp_oauth_callback_page(
            ok=False, status="failed", failure_code="invalid_state"
        )
    if result.callback_surface == "web" and result.return_path:
        return RedirectResponse(
            build_oauth_web_completion_url(
                frontend_base_url=settings.frontend_base_url,
                return_path=result.return_path,
                flow_id=str(result.flow_id) if result.flow_id else "",
                status=result.status,
                final_surface=result.final_surface,
                failure_code=result.failure_code,
            ),
            status_code=303,
        )
    return make_mcp_oauth_callback_page(
        ok=result.ok,
        status=result.status,
        flow_id=result.flow_id,
        failure_code=result.failure_code,
    )


@router.get("/availability", response_model=list[IntegrationAvailabilityItem])
async def integration_availability_endpoint(
    organization_id: UUID | None = Query(default=None, alias="organizationId"),
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[IntegrationAvailabilityItem]:
    return await list_integration_availability(
        db,
        user_id=user.id,
        organization_id=organization_id,
    )


@router.get("/tool-metadata", response_model=list[IntegrationToolMetadata])
async def integration_tool_metadata_endpoint(
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[IntegrationToolMetadata]:
    return await list_integration_tool_metadata(db, user_id=user.id)
