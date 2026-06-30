"""HTTP API for agent LLM auth gateway state."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.constants.cloud import CloudAgentKind
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.agent_auth.models import (
    AgentAuthCredentialResponse,
    AgentAuthCredentialShareResponse,
    AgentAuthMutationResponse,
    CreateGatewayCredentialRequest,
    CreateGatewayCredentialResponse,
    DesktopAgentAuthConfigApplyRequestInput,
    DesktopAgentAuthConfigApplyResponse,
    DesktopAgentAuthConfigApplyStatusRequest,
    EnsureFreeManagedCreditsRequest,
    EnsureFreeManagedCreditsResponse,
    EnsureManagedCreditsRequest,
    EnsureManagedCreditsResponse,
    FreeManagedCreditReadyAgentModelResponse,
    SandboxAgentAuthSelectionResponse,
    SandboxProfileAgentAuthTargetStateResponse,
    SelectAgentAuthCredentialRequest,
    ShareCredentialRequest,
    SyncSyncedCredentialRequest,
    SyncSyncedCredentialResponse,
    WorkerAgentAuthMaterializationPlan,
    WorkerAgentAuthStatusRequest,
    WorkerAgentAuthStatusResponse,
    budget_subject_response,
    credential_response,
    credential_share_response,
    free_credit_entitlement_response,
    policy_response,
    provider_credential_response,
    selection_response,
    target_state_response,
)
from proliferate.server.cloud.agent_auth.service import (
    create_gateway_credential,
    desktop_agent_auth_config_apply_request,
    ensure_free_managed_credits_for_user,
    ensure_managed_credits_for_organization,
    list_credentials_for_response,
    list_selections,
    list_target_states,
    record_desktop_agent_auth_config_status,
    record_worker_agent_auth_status,
    revoke_credential,
    revoke_credential_share,
    select_credential_for_profile,
    share_personal_credential_with_organization,
    sync_synced_credential_for_user,
    worker_agent_auth_materialization_plan,
)
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.sandbox_profiles.service import get_profile
from proliferate.server.cloud.worker.auth import authenticate_worker

router = APIRouter()
worker_router = APIRouter(
    prefix="/worker/agent-auth-configs",
    tags=["cloud-worker-agent-auth"],
)


@router.get("/agent-auth/credentials", response_model=list[AgentAuthCredentialResponse])
async def list_agent_auth_credentials_endpoint(
    organization_id: UUID | None = Query(default=None, alias="organizationId"),
    credential_provider_id: str | None = Query(default=None, alias="credentialProviderId"),
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[AgentAuthCredentialResponse]:
    return [
        credential_response(
            item.credential,
            active_credential_share_id=item.active_share.id if item.active_share else None,
        )
        for item in await list_credentials_for_response(
            db,
            actor_user_id=user.id,
            organization_id=organization_id,
            credential_provider_id=credential_provider_id,
        )
    ]


@router.post("/agent-auth/credentials/gateway")
async def create_gateway_credential_endpoint(
    body: CreateGatewayCredentialRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CreateGatewayCredentialResponse:
    result = await create_gateway_credential(db, actor_user_id=user.id, body=body)
    return CreateGatewayCredentialResponse(
        credential=credential_response(result.credential),
        policy=policy_response(result.policy),
        providerCredential=provider_credential_response(result.provider_credential),
    )


@router.put(
    "/agent-auth/credentials/synced/{agent_kind}",
    response_model=SyncSyncedCredentialResponse,
)
async def sync_synced_agent_auth_credential_endpoint(
    agent_kind: CloudAgentKind,
    body: SyncSyncedCredentialRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> SyncSyncedCredentialResponse:
    result = await sync_synced_credential_for_user(
        db,
        actor_user_id=user.id,
        agent_kind=agent_kind,
        body=body,
    )
    return SyncSyncedCredentialResponse(
        changed=result.changed,
        credential=credential_response(result.credential),
        selection=selection_response(result.selection),
    )


@router.post(
    "/agent-auth/free-credits/ensure",
    response_model=EnsureFreeManagedCreditsResponse,
)
async def ensure_free_managed_credits_endpoint(
    body: EnsureFreeManagedCreditsRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> EnsureFreeManagedCreditsResponse:
    result = await ensure_free_managed_credits_for_user(
        db,
        actor_user_id=user.id,
        body=body,
    )
    return EnsureFreeManagedCreditsResponse(
        status=result.status,
        launchEnabled=result.launch_enabled,
        primaryAction=result.primary_action,
        readyAgentModels=[
            FreeManagedCreditReadyAgentModelResponse(
                agentKind=model.agent_kind,
                publicModelNames=list(model.public_model_names),
                credentialId=model.credential_id,
            )
            for model in result.ready_agent_models
        ],
        entitlement=(
            free_credit_entitlement_response(result.entitlement)
            if result.entitlement is not None
            else None
        ),
        budgetSubject=(
            budget_subject_response(result.budget_subject)
            if result.budget_subject is not None
            else None
        ),
        credentials=[credential_response(record) for record in result.credentials],
        policies=[policy_response(record) for record in result.policies],
        lastErrorCode=result.last_error_code,
        lastErrorMessage=result.last_error_message,
    )


@router.post(
    "/organizations/{organization_id}/agent-auth/managed-credits",
    response_model=EnsureManagedCreditsResponse,
)
async def ensure_managed_credits_endpoint(
    organization_id: UUID,
    body: EnsureManagedCreditsRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> EnsureManagedCreditsResponse:
    result = await ensure_managed_credits_for_organization(
        db,
        actor_user_id=user.id,
        organization_id=organization_id,
        body=body,
    )
    return EnsureManagedCreditsResponse(
        budgetSubject=budget_subject_response(result.budget_subject),
        credentials=[credential_response(record) for record in result.credentials],
        policies=[policy_response(record) for record in result.policies],
    )


@router.delete("/agent-auth/credentials/{credential_id}")
async def revoke_agent_auth_credential_endpoint(
    credential_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> AgentAuthMutationResponse:
    await revoke_credential(db, actor_user_id=user.id, credential_id=credential_id)
    return AgentAuthMutationResponse(changed=True)


@router.post("/agent-auth/credentials/{credential_id}/shares")
async def share_agent_auth_credential_endpoint(
    credential_id: UUID,
    body: ShareCredentialRequest,
    user: User = Depends(current_product_user),
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
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> AgentAuthCredentialShareResponse:
    share = await revoke_credential_share(db, actor_user_id=user.id, share_id=share_id)
    return credential_share_response(share)


@router.get(
    "/sandbox-profiles/{sandbox_profile_id}/agent-auth-selections",
    response_model=list[SandboxAgentAuthSelectionResponse],
)
async def list_agent_auth_selections_endpoint(
    sandbox_profile_id: UUID,
    user: User = Depends(current_product_user),
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


@router.put(
    "/sandbox-profiles/{sandbox_profile_id}/agent-auth-selections/{agent_kind}/{auth_slot_id}"
)
async def select_agent_auth_credential_endpoint(
    sandbox_profile_id: UUID,
    agent_kind: CloudAgentKind,
    auth_slot_id: str,
    body: SelectAgentAuthCredentialRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> SandboxAgentAuthSelectionResponse:
    selection = await select_credential_for_profile(
        db,
        actor_user_id=user.id,
        sandbox_profile_id=sandbox_profile_id,
        agent_kind=agent_kind,
        auth_slot_id=auth_slot_id,
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
    user: User = Depends(current_product_user),
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


@router.post(
    "/sandbox-profiles/{sandbox_profile_id}/agent-auth-config/desktop-apply-request",
    response_model=DesktopAgentAuthConfigApplyResponse,
)
async def desktop_agent_auth_config_apply_request_endpoint(
    sandbox_profile_id: UUID,
    body: DesktopAgentAuthConfigApplyRequestInput,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> DesktopAgentAuthConfigApplyResponse:
    try:
        profile = await get_profile(db, user=user, sandbox_profile_id=sandbox_profile_id)
        return await desktop_agent_auth_config_apply_request(
            db,
            profile=profile,
            target_id=body.target_id,
            actor_user_id=user.id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post(
    "/sandbox-profiles/{sandbox_profile_id}/agent-auth-config/desktop-apply-status",
    response_model=AgentAuthMutationResponse,
)
async def desktop_agent_auth_config_apply_status_endpoint(
    sandbox_profile_id: UUID,
    body: DesktopAgentAuthConfigApplyStatusRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> AgentAuthMutationResponse:
    try:
        profile = await get_profile(db, user=user, sandbox_profile_id=sandbox_profile_id)
        await record_desktop_agent_auth_config_status(
            db,
            profile=profile,
            body=body,
            actor_user_id=user.id,
        )
        return AgentAuthMutationResponse(changed=True)
    except CloudApiError as error:
        raise_cloud_error(error)


@worker_router.get(
    "/{sandbox_profile_id}/materialization",
    response_model=WorkerAgentAuthMaterializationPlan,
)
async def worker_agent_auth_materialization_endpoint(
    sandbox_profile_id: UUID,
    revision: int,
    command_id: UUID,
    lease_id: str,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerAgentAuthMaterializationPlan:
    auth = await authenticate_worker(db, authorization=authorization)
    return await worker_agent_auth_materialization_plan(
        db,
        auth=auth,
        sandbox_profile_id=sandbox_profile_id,
        command_id=command_id,
        revision=revision,
        lease_id=lease_id,
    )


@worker_router.post(
    "/{sandbox_profile_id}/status",
    response_model=WorkerAgentAuthStatusResponse,
)
async def worker_agent_auth_status_endpoint(
    sandbox_profile_id: UUID,
    body: WorkerAgentAuthStatusRequest,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerAgentAuthStatusResponse:
    auth = await authenticate_worker(db, authorization=authorization)
    return await record_worker_agent_auth_status(
        db,
        auth=auth,
        sandbox_profile_id=sandbox_profile_id,
        body=body,
    )
