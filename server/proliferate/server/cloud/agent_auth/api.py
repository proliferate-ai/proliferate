"""HTTP API for agent LLM auth gateway state."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.constants.cloud import CloudAgentKind
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.agent_auth.models import (
    AgentAuthCredentialResponse,
    AgentAuthCredentialShareResponse,
    AgentAuthMutationResponse,
    CreateGatewayCredentialRequest,
    CreateGatewayCredentialResponse,
    EnsureOrganizationSandboxProfileRequest,
    EnsurePersonalSandboxProfileRequest,
    SandboxAgentAuthSelectionResponse,
    SandboxProfileAgentAuthTargetStateResponse,
    SandboxProfileResponse,
    SelectAgentAuthCredentialRequest,
    ShareCredentialRequest,
    credential_response,
    credential_share_response,
    policy_response,
    provider_credential_response,
    sandbox_profile_response,
    selection_response,
    target_state_response,
)
from proliferate.server.cloud.agent_auth.service import (
    create_gateway_credential,
    ensure_organization_sandbox_profile,
    ensure_personal_sandbox_profile,
    list_credentials,
    list_selections,
    list_target_states,
    revoke_credential,
    revoke_credential_share,
    select_credential_for_profile,
    share_personal_credential_with_organization,
)

router = APIRouter()


@router.get("/agent-auth/credentials", response_model=list[AgentAuthCredentialResponse])
async def list_agent_auth_credentials_endpoint(
    organization_id: UUID | None = Query(default=None, alias="organizationId"),
    agent_kind: str | None = Query(default=None, alias="agentKind"),
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[AgentAuthCredentialResponse]:
    return [
        credential_response(record)
        for record in await list_credentials(
            db,
            actor_user_id=user.id,
            organization_id=organization_id,
            agent_kind=agent_kind,
        )
    ]


@router.post("/agent-auth/credentials/gateway")
async def create_gateway_credential_endpoint(
    body: CreateGatewayCredentialRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> CreateGatewayCredentialResponse:
    result = await create_gateway_credential(db, actor_user_id=user.id, body=body)
    return CreateGatewayCredentialResponse(
        credential=credential_response(result.credential),
        policy=policy_response(result.policy),
        providerCredential=provider_credential_response(result.provider_credential),
    )


@router.delete("/agent-auth/credentials/{credential_id}")
async def revoke_agent_auth_credential_endpoint(
    credential_id: UUID,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> AgentAuthMutationResponse:
    await revoke_credential(db, actor_user_id=user.id, credential_id=credential_id)
    return AgentAuthMutationResponse(changed=True)


@router.post("/agent-auth/credentials/{credential_id}/shares")
async def share_agent_auth_credential_endpoint(
    credential_id: UUID,
    body: ShareCredentialRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> AgentAuthCredentialShareResponse:
    share = await share_personal_credential_with_organization(
        db,
        actor_user_id=user.id,
        credential_id=credential_id,
        organization_id=body.organization_id,
    )
    return credential_share_response(share)


@router.delete("/agent-auth/credential-shares/{share_id}")
async def revoke_agent_auth_credential_share_endpoint(
    share_id: UUID,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> AgentAuthCredentialShareResponse:
    share = await revoke_credential_share(db, actor_user_id=user.id, share_id=share_id)
    return credential_share_response(share)


@router.post("/sandbox-profiles/personal")
async def ensure_personal_sandbox_profile_endpoint(
    body: EnsurePersonalSandboxProfileRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> SandboxProfileResponse:
    profile = await ensure_personal_sandbox_profile(
        db,
        actor_user_id=user.id,
        managed_target_id=body.managed_target_id,
    )
    return sandbox_profile_response(profile)


@router.post("/organizations/{organization_id}/sandbox-profile")
async def ensure_organization_sandbox_profile_endpoint(
    organization_id: UUID,
    body: EnsureOrganizationSandboxProfileRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> SandboxProfileResponse:
    profile = await ensure_organization_sandbox_profile(
        db,
        actor_user_id=user.id,
        organization_id=organization_id,
        managed_target_id=body.managed_target_id,
    )
    return sandbox_profile_response(profile)


@router.get(
    "/sandbox-profiles/{sandbox_profile_id}/agent-auth-selections",
    response_model=list[SandboxAgentAuthSelectionResponse],
)
async def list_agent_auth_selections_endpoint(
    sandbox_profile_id: UUID,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[SandboxAgentAuthSelectionResponse]:
    return [
        selection_response(record)
        for record in await list_selections(
            db,
            actor_user_id=user.id,
            sandbox_profile_id=sandbox_profile_id,
        )
    ]


@router.put("/sandbox-profiles/{sandbox_profile_id}/agent-auth-selections/{agent_kind}")
async def select_agent_auth_credential_endpoint(
    sandbox_profile_id: UUID,
    agent_kind: CloudAgentKind,
    body: SelectAgentAuthCredentialRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> SandboxAgentAuthSelectionResponse:
    selection = await select_credential_for_profile(
        db,
        actor_user_id=user.id,
        sandbox_profile_id=sandbox_profile_id,
        agent_kind=agent_kind,
        credential_id=body.credential_id,
        credential_share_id=body.credential_share_id,
        force_restart=body.force_restart,
    )
    return selection_response(selection)


@router.get(
    "/sandbox-profiles/{sandbox_profile_id}/agent-auth-target-states",
    response_model=list[SandboxProfileAgentAuthTargetStateResponse],
)
async def list_agent_auth_target_states_endpoint(
    sandbox_profile_id: UUID,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[SandboxProfileAgentAuthTargetStateResponse]:
    return [
        target_state_response(record)
        for record in await list_target_states(
            db,
            actor_user_id=user.id,
            sandbox_profile_id=sandbox_profile_id,
        )
    ]
