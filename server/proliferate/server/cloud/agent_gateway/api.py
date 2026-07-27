"""HTTP routes for the agent-auth platform plus the agent-gateway account.

Two prefixes out of this one module (S1, agent-auth.md/model-gateway.md
API surface): ``router``/``organization_router`` serve ``/agent-auth``
(key vault, selections, state, org policy); ``gateway_account_router``
serves ``/agent-gateway`` (enrollment, capabilities — the gateway-account
concerns model-gateway.md scopes that prefix to). Model catalogs moved out
earlier: the cloud snapshot's routes live in their own ``agent_models``
namespace (model-catalog.md §Cloud routes), named off both "gateway" (they
serve every auth context) and "catalog".
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.permissions import CurrentOrgUser, current_path_org_admin
from proliferate.server.cloud.agent_gateway import service
from proliferate.server.cloud.agent_gateway.models import (
    AgentApiKeyCreateRequest,
    AgentApiKeyResponse,
    AgentAuthSelectionResponse,
    AgentAuthSelectionsPutRequest,
    AgentAuthStateResponse,
    AgentAuthSurface,
    AgentGatewayCapabilitiesResponse,
    AgentGatewayEnrollmentResponse,
    AgentProviderConfigCreateRequest,
    OrgAgentPolicyResponse,
    OrgAgentPolicyUpdateRequest,
    OrgAgentPolicyViolationListResponse,
    agent_auth_state_payload,
    api_key_payload,
    auth_selection_payload,
    desired_source,
    enrollment_payload,
    org_agent_policy_payload,
    org_agent_policy_violation_payload,
)
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error

router = APIRouter(prefix="/agent-auth", tags=["cloud-agent-auth"])

organization_router = APIRouter(
    prefix="/organizations/{organization_id}/agent-auth",
    tags=["cloud-agent-auth"],
)

# Enrollment + capabilities are gateway-account concerns (model-gateway.md
# API surface) and stay under /agent-gateway; every other route on `router`
# (vault, selections, state) and every `organization_router` route (org
# policy) moved to /agent-auth (agent-auth.md API surface).
gateway_account_router = APIRouter(prefix="/agent-gateway", tags=["cloud-agent-gateway"])


# --------------------------------------------------------------------------- #
# Key vault
# --------------------------------------------------------------------------- #


@router.get("/keys", response_model=list[AgentApiKeyResponse])
async def list_agent_api_keys_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> list[AgentApiKeyResponse]:
    records = await service.list_api_keys(db, user_id=user.id)
    return [api_key_payload(record) for record in records]


@router.post("/keys", response_model=AgentApiKeyResponse)
async def create_agent_api_key_endpoint(
    body: AgentApiKeyCreateRequest,
    db: AsyncSession = Depends(get_async_session, scope="function"),
    user: User = Depends(current_product_user),
) -> AgentApiKeyResponse:
    try:
        record = await service.create_api_key(
            db,
            user_id=user.id,
            title=body.title,
            value=body.value,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return api_key_payload(record)


@router.post("/keys/provider-config", response_model=AgentApiKeyResponse)
async def create_agent_provider_config_endpoint(
    body: AgentProviderConfigCreateRequest,
    db: AsyncSession = Depends(get_async_session, scope="function"),
    user: User = Depends(current_product_user),
) -> AgentApiKeyResponse:
    """Create a typed vault entry (Bedrock/Azure) — D2's modal's request shape.

    A distinct route rather than overloading ``POST /keys``: the request body
    shape genuinely differs (a field map, not one secret string) and a typed
    entry is not bound to any harness until a selection references it, same
    as a bare key.
    """
    try:
        record = await service.create_provider_config(
            db,
            user_id=user.id,
            title=body.title,
            kind=body.kind,
            value=body.value,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return api_key_payload(record)


@router.delete("/keys/{key_id}", response_model=AgentApiKeyResponse)
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


# --------------------------------------------------------------------------- #
# Auth selections
# --------------------------------------------------------------------------- #


@router.get("/selections", response_model=list[AgentAuthSelectionResponse])
async def list_agent_auth_selections_endpoint(
    surface: AgentAuthSurface | None = Query(default=None),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> list[AgentAuthSelectionResponse]:
    records = await service.list_auth_selections(db, user_id=user.id, surface=surface)
    titles = await service.key_titles(db, user_id=user.id)
    return [
        auth_selection_payload(record, key_title=titles.get(record.api_key_id))
        for record in records
    ]


@router.put(
    "/selections/{harness_kind}",
    response_model=list[AgentAuthSelectionResponse],
)
async def put_agent_auth_selections_endpoint(
    harness_kind: str,
    body: AgentAuthSelectionsPutRequest,
    surface: AgentAuthSurface = Query(...),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> list[AgentAuthSelectionResponse]:
    try:
        sources = [desired_source(source) for source in body.sources]
    except ValueError:
        raise_cloud_error(
            CloudApiError(
                "invalid_agent_auth_selection",
                "apiKeyId must be a UUID.",
                status_code=400,
            )
        )
    try:
        records = await service.put_auth_selections(
            db,
            user_id=user.id,
            harness_kind=harness_kind,
            surface=surface,
            sources=sources,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    # Persist settings alongside sources when provided.
    if body.settings is not None:
        try:
            await service.put_harness_settings(
                db,
                user_id=user.id,
                harness_kind=harness_kind,
                surface=surface,
                settings_dict=body.settings,
            )
        except CloudApiError as error:
            raise_cloud_error(error)
    titles = await service.key_titles(db, user_id=user.id)
    return [
        auth_selection_payload(record, key_title=titles.get(record.api_key_id))
        for record in records
    ]


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
    """Serve the caller's rendered ``state.json`` v2 document for one surface.

    This is the local-surface twin of the cloud materializer: the desktop
    fetches ``surface=local`` and pushes the payload to its local AnyHarness
    runtime, which persists it at ``<runtime_home>/agent-auth/state.json``.

    Trust model: the response carries the current user's OWN decrypted key
    material (vault keys, gateway virtual key) — the same secrets the cloud
    materializer writes into the user's own sandbox. Nothing crosses a user
    boundary.
    """
    state = await service.get_auth_state(db, user_id=user.id, surface=surface)
    return agent_auth_state_payload(state)


# --------------------------------------------------------------------------- #
# Capabilities + enrollment
# --------------------------------------------------------------------------- #


@gateway_account_router.get("/capabilities", response_model=AgentGatewayCapabilitiesResponse)
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


@gateway_account_router.get("/enrollment", response_model=AgentGatewayEnrollmentResponse)
async def get_agent_gateway_enrollment_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentGatewayEnrollmentResponse:
    try:
        record = await service.get_enrollment(db, user_id=user.id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return enrollment_payload(record)


# --------------------------------------------------------------------------- #
# Org policy (flag-only)
# --------------------------------------------------------------------------- #


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
