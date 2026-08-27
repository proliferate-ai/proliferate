"""HTTP routes for the agent-auth platform.

``router``/``organization_router`` serve ``/agent-auth`` (key vault,
selections, state, org policy — the agent-auth.md API surface). The
gateway-account routes (``/agent-gateway``: enrollment, capabilities) live
in ``proliferate.server.ai_gateway.api``. Model catalogs moved out earlier:
the cloud snapshot's routes live in their own ``agent_models`` namespace
(model-catalog.md §Cloud routes), named off both "gateway" (they serve every
auth context) and "catalog".
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.permissions import CurrentOrgUser, current_path_org_admin
from proliferate.server.agent_auth import harness_settings, seats, service
from proliferate.server.agent_auth.models import (
    AgentApiKeyCreateRequest,
    AgentApiKeyResponse,
    AgentAuthDeliveryAckResponse,
    AgentAuthSelectionResponse,
    AgentAuthSelectionsPutRequest,
    AgentAuthStateAckRequest,
    AgentAuthStateResponse,
    AgentAuthSurface,
    AgentProviderConfigCreateRequest,
    OrgAgentPolicyResponse,
    OrgAgentPolicyUpdateRequest,
    OrgAgentPolicyViolationListResponse,
    agent_auth_state_payload,
    api_key_payload,
    auth_selection_payload,
    delivery_ack_payload,
    desired_source,
    org_agent_policy_payload,
    org_agent_policy_violation_payload,
)
from proliferate.server.api_errors import CloudApiError

router = APIRouter(prefix="/agent-auth", tags=["cloud-agent-auth"])

organization_router = APIRouter(
    prefix="/organizations/{organization_id}/agent-auth",
    tags=["cloud-agent-auth"],
)


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
    """Create a bare vault key — or a seat, the mint flow's courier upload.

    ``kind='anthropic_subscription'`` is the one upward secret path of the
    seat mint (agent_auth spec §3 flow 2): the runtime captured the token in
    memory, the courier POSTs it here exactly once, and the label fields
    carry the user-entered seat identity.
    """
    if body.kind == "anthropic_subscription":
        record = await seats.create_seat(
            db,
            user_id=user.id,
            token=body.value,
            title=body.title,
            email=body.email,
            plan_tier=body.plan_tier,
        )
        return api_key_payload(record)
    if body.title is None:
        raise CloudApiError(
            "invalid_agent_api_key_title",
            "Title is required for an api_key vault entry.",
            status_code=400,
        )
    record = await service.create_api_key(
        db,
        user_id=user.id,
        title=body.title,
        value=body.value,
    )
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
    record = await service.create_provider_config(
        db,
        user_id=user.id,
        title=body.title,
        kind=body.kind,
        value=body.value,
    )
    return api_key_payload(record)


@router.delete("/keys/{key_id}", response_model=AgentApiKeyResponse)
async def revoke_agent_api_key_endpoint(
    key_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentApiKeyResponse:
    record = await service.revoke_api_key(db, user_id=user.id, api_key_id=key_id)
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
    applied = await service.annotate_selection_delivery(db, user_id=user.id, records=records)
    return [
        auth_selection_payload(
            record,
            key_title=titles.get(record.api_key_id),
            applied=applied.get(record.id, False),
        )
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
    except ValueError as error:
        raise CloudApiError(
            "invalid_agent_auth_selection",
            "apiKeyId must be a UUID.",
            status_code=400,
        ) from error
    records = await service.put_auth_selections(
        db,
        user_id=user.id,
        harness_kind=harness_kind,
        surface=surface,
        sources=sources,
    )
    # Persist settings alongside sources when provided.
    if body.settings is not None:
        await harness_settings.put_harness_settings(
            db,
            user_id=user.id,
            harness_kind=harness_kind,
            surface=surface,
            settings_dict=body.settings,
        )
    titles = await service.key_titles(db, user_id=user.id)
    applied = await service.annotate_selection_delivery(db, user_id=user.id, records=records)
    return [
        auth_selection_payload(
            record,
            key_title=titles.get(record.api_key_id),
            applied=applied.get(record.id, False),
        )
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
    state, fingerprint, settings_by_harness = await service.get_auth_state(
        db, user_id=user.id, surface=surface
    )
    return agent_auth_state_payload(
        state, fingerprint=fingerprint, harness_settings=settings_by_harness
    )


@router.post("/state/ack", response_model=AgentAuthDeliveryAckResponse)
async def ack_agent_auth_state_endpoint(
    body: AgentAuthStateAckRequest,
    surface: AgentAuthSurface = Query(...),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentAuthDeliveryAckResponse:
    """Record a surface runtime's delivery acknowledgement (the desktop seam).

    The desktop calls this after its local runtime's state PUT/DELETE
    succeeded, echoing the pushed document's ``revision`` and the served
    ``fingerprint`` from ``GET /state``. This stamp is what flips the
    selections read from pending to applied (agent-auth.md "Applied means
    acknowledged"). The cloud surface's twin is stamped server-side by the
    materialization worker, not through this route.
    """
    record = await service.ack_auth_state_delivery(
        db,
        user_id=user.id,
        surface=surface,
        revision=body.revision,
        fingerprint=body.fingerprint,
    )
    return delivery_ack_payload(record)


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
    snapshot = await service.update_org_policy(
        db,
        organization_id=org_admin.organization_id,
        updated_by_user_id=org_admin.actor_user_id,
        allowed_routes=body.allowed_routes,
        allowed_harnesses=body.allowed_harnesses,
    )
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
