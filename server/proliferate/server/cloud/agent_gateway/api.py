"""HTTP routes for agent gateway auth: key pool, selections, catalog."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.agent_gateway import catalog as catalog_service
from proliferate.server.cloud.agent_gateway import service
from proliferate.server.cloud.agent_gateway.models import (
    AgentApiKeyCreateRequest,
    AgentApiKeyListResponse,
    AgentApiKeyResponse,
    AgentAuthRoute,
    AgentAuthRouteSelectionListResponse,
    AgentAuthRouteSelectionResponse,
    AgentAuthRouteSelectionUpsertRequest,
    AgentAuthStateResponse,
    AgentAuthSurface,
    AgentGatewayCapabilitiesResponse,
    AgentGatewayCatalogOverrideResponse,
    AgentGatewayCatalogOverrideUpsertRequest,
    AgentGatewayCatalogRefreshRequest,
    AgentGatewayCatalogResponse,
    AgentGatewayEnrollmentResponse,
    agent_auth_state_payload,
    api_key_payload,
    catalog_override_payload,
    catalog_payload,
    enrollment_payload,
    provider_registry_payload,
    route_selection_payload,
)
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error

router = APIRouter(prefix="/agent-gateway", tags=["cloud-agent-gateway"])


def _parse_uuid(value: str, *, code: str, message: str, status_code: int) -> UUID:
    try:
        return UUID(value)
    except ValueError as error:
        raise CloudApiError(code, message, status_code=status_code) from error


@router.get("/api-keys", response_model=AgentApiKeyListResponse)
async def list_agent_api_keys_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentApiKeyListResponse:
    records = await service.list_api_keys(db, user_id=user.id)
    return AgentApiKeyListResponse(keys=[api_key_payload(record) for record in records])


@router.post("/api-keys", response_model=AgentApiKeyResponse)
async def create_agent_api_key_endpoint(
    body: AgentApiKeyCreateRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentApiKeyResponse:
    try:
        record = await service.create_api_key(
            db,
            user_id=user.id,
            provider=body.provider,
            display_name=body.display_name,
            secret=body.secret,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return api_key_payload(record)


@router.delete("/api-keys/{key_id}", response_model=AgentApiKeyResponse)
async def revoke_agent_api_key_endpoint(
    key_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentApiKeyResponse:
    try:
        record = await service.revoke_api_key(db, user_id=user.id, api_key_id=key_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return api_key_payload(record)


@router.get("/route-selections", response_model=AgentAuthRouteSelectionListResponse)
async def list_agent_route_selections_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentAuthRouteSelectionListResponse:
    records = await service.list_route_selections(db, user_id=user.id)
    return AgentAuthRouteSelectionListResponse(
        selections=[route_selection_payload(record) for record in records],
    )


@router.put(
    "/route-selections/{harness_kind}/{surface}",
    response_model=AgentAuthRouteSelectionResponse,
)
async def upsert_agent_route_selection_endpoint(
    harness_kind: str,
    surface: str,
    body: AgentAuthRouteSelectionUpsertRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentAuthRouteSelectionResponse:
    try:
        api_key_id: UUID | None = None
        if body.api_key_id is not None:
            api_key_id = _parse_uuid(
                body.api_key_id,
                code="invalid_agent_route_selection",
                message="apiKeyId must be a UUID.",
                status_code=400,
            )
        record = await service.upsert_route_selection(
            db,
            user_id=user.id,
            harness_kind=harness_kind,
            surface=surface,
            route=body.route,
            api_key_id=api_key_id,
            slot=body.slot,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return route_selection_payload(record)


@router.delete("/route-selections/{harness_kind}/{surface}", status_code=204)
async def clear_agent_route_selection_endpoint(
    harness_kind: str,
    surface: str,
    slot: str = Query("primary"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> None:
    try:
        await service.clear_route_selection(
            db,
            user_id=user.id,
            harness_kind=harness_kind,
            surface=surface,
            slot=slot,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get(
    "/state",
    response_model=AgentAuthStateResponse,
    response_model_exclude_none=True,
)
async def get_agent_auth_state_endpoint(
    surface: AgentAuthSurface = Query(...),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentAuthStateResponse:
    """Serve the caller's rendered state.json document for one surface.

    This is the local-surface twin of the cloud materializer: the desktop
    fetches ``surface=local`` and pushes the payload verbatim to its local
    AnyHarness runtime (``PUT /v1/agent-auth/state``), which persists it at
    ``<runtime_home>/agent-auth/state.json``.

    Trust model: the response carries the current user's OWN decrypted key
    material (pool keys, gateway virtual key) — the same secrets the cloud
    materializer writes into the user's own sandbox. Auth is the current
    product user; nothing here crosses a user boundary.
    """
    state = await service.get_auth_state(db, user_id=user.id, surface=surface)
    return agent_auth_state_payload(state, user_id=str(user.id))


@router.get("/catalog/{harness_kind}", response_model=AgentGatewayCatalogResponse)
async def get_agent_catalog_endpoint(
    harness_kind: str,
    surface: AgentAuthSurface = Query(...),
    route: AgentAuthRoute = Query("gateway"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentGatewayCatalogResponse:
    snapshot, override, models = await catalog_service.get_catalog(
        db,
        user_id=user.id,
        harness_kind=harness_kind,
        surface=surface,
        route=route,
    )
    return catalog_payload(
        harness_kind=harness_kind,
        surface=surface,
        route=route,
        models=models,
        snapshot=snapshot,
        override=override,
    )


@router.post("/catalog/{harness_kind}/refresh", response_model=AgentGatewayCatalogResponse)
async def refresh_agent_catalog_endpoint(
    harness_kind: str,
    body: AgentGatewayCatalogRefreshRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentGatewayCatalogResponse:
    try:
        snapshot, override, models = await catalog_service.refresh_catalog(
            db,
            user_id=user.id,
            harness_kind=harness_kind,
            surface=body.surface,
            route=body.route,
            models_json=body.models_json,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return catalog_payload(
        harness_kind=harness_kind,
        surface=body.surface,
        route=body.route,
        models=models,
        snapshot=snapshot,
        override=override,
    )


@router.put("/catalog/{harness_kind}/override", response_model=AgentGatewayCatalogOverrideResponse)
async def upsert_agent_catalog_override_endpoint(
    harness_kind: str,
    body: AgentGatewayCatalogOverrideUpsertRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentGatewayCatalogOverrideResponse:
    try:
        record = await catalog_service.upsert_override(
            db,
            user_id=user.id,
            harness_kind=harness_kind,
            patch_json=body.patch_json,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return catalog_override_payload(record)


@router.delete("/catalog/{harness_kind}/override", status_code=204)
async def delete_agent_catalog_override_endpoint(
    harness_kind: str,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> None:
    try:
        await catalog_service.delete_override(
            db,
            user_id=user.id,
            harness_kind=harness_kind,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("/capabilities", response_model=AgentGatewayCapabilitiesResponse)
async def get_agent_gateway_capabilities_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentGatewayCapabilitiesResponse:
    gateway_enabled, public_base_url, enrollment_status = await service.get_capabilities(
        db,
        user_id=user.id,
    )
    return AgentGatewayCapabilitiesResponse(
        gateway_enabled=gateway_enabled,
        public_base_url=public_base_url,
        enrollment_status=enrollment_status,
        providers=provider_registry_payload(),
    )


@router.get("/enrollment", response_model=AgentGatewayEnrollmentResponse)
async def get_agent_gateway_enrollment_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentGatewayEnrollmentResponse:
    try:
        record = await service.get_enrollment(db, user_id=user.id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return enrollment_payload(record)
