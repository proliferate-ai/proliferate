"""HTTP routes for agent gateway auth: key pool, route selections, capabilities."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.permissions import CurrentOrgUser, current_path_org_admin
from proliferate.server.cloud.agent_gateway import service
from proliferate.server.cloud.agent_gateway.models import (
    AgentApiKeyCreateRequest,
    AgentApiKeyListResponse,
    AgentApiKeyResponse,
    AgentAuthRouteSelectionListResponse,
    AgentAuthRouteSelectionResponse,
    AgentAuthRouteSelectionUpsertRequest,
    AgentGatewayCapabilitiesResponse,
    AgentGatewayEnrollmentResponse,
    OrgAgentPolicyResponse,
    OrgAgentPolicyUpdateRequest,
    OrgAgentPolicyViolationListResponse,
    api_key_payload,
    enrollment_payload,
    org_agent_policy_payload,
    org_agent_policy_violation_payload,
    route_selection_payload,
)
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error

router = APIRouter(prefix="/agent-gateway", tags=["cloud-agent-gateway"])

organization_router = APIRouter(
    prefix="/organizations/{organization_id}/agent-gateway",
    tags=["cloud-agent-gateway"],
)


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
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return route_selection_payload(record)


@router.delete("/route-selections/{harness_kind}/{surface}", status_code=204)
async def clear_agent_route_selection_endpoint(
    harness_kind: str,
    surface: str,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> None:
    try:
        await service.clear_route_selection(
            db,
            user_id=user.id,
            harness_kind=harness_kind,
            surface=surface,
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


@organization_router.get("/policy", response_model=OrgAgentPolicyResponse)
async def get_org_agent_policy_endpoint(
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    db: AsyncSession = Depends(get_async_session),
) -> OrgAgentPolicyResponse:
    snapshot = await service.get_org_policy(
        db,
        organization_id=org_admin.organization_id,
    )
    return org_agent_policy_payload(snapshot)


@organization_router.put("/policy", response_model=OrgAgentPolicyResponse)
async def put_org_agent_policy_endpoint(
    body: OrgAgentPolicyUpdateRequest,
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    db: AsyncSession = Depends(get_async_session),
) -> OrgAgentPolicyResponse:
    try:
        snapshot = await service.update_org_policy(
            db,
            organization_id=org_admin.organization_id,
            updated_by_user_id=org_admin.actor_user_id,
            allowed_routes=body.allowed_routes,
            allowed_harnesses=body.allowed_harnesses,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return org_agent_policy_payload(snapshot)


@organization_router.get(
    "/policy/violations",
    response_model=OrgAgentPolicyViolationListResponse,
)
async def list_org_agent_policy_violations_endpoint(
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    db: AsyncSession = Depends(get_async_session),
) -> OrgAgentPolicyViolationListResponse:
    violations = await service.list_org_policy_violations(
        db,
        organization_id=org_admin.organization_id,
    )
    return OrgAgentPolicyViolationListResponse(
        violations=[org_agent_policy_violation_payload(record) for record in violations],
    )
