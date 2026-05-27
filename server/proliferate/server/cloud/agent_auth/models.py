"""Request and response schemas for cloud agent auth."""

from __future__ import annotations

import json
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialRecord,
    AgentAuthCredentialShareRecord,
    AgentGatewayBudgetSubjectRecord,
    AgentGatewayFreeCreditEntitlementRecord,
    AgentGatewayPolicyRecord,
    AgentGatewayProviderCredentialRecord,
    SandboxAgentAuthSelectionRecord,
    SandboxProfileAgentAuthTargetStateRecord,
    SandboxProfileRecord,
)
from proliferate.server.cloud.agent_auth.domain.types import SyncedCredentialAuthMode

AgentKind = Literal["claude", "codex", "opencode", "gemini"]
OwnerScope = Literal["personal", "organization"]


class EnsurePersonalSandboxProfileRequest(BaseModel):
    pass


class EnsureOrganizationSandboxProfileRequest(BaseModel):
    pass


class GatewayModelDeploymentRequest(BaseModel):
    public_model_name: str = Field(alias="publicModelName")
    provider_model: str = Field(alias="providerModel")


class EnsureManagedCreditsRequest(BaseModel):
    pass


class EnsureFreeManagedCreditsRequest(BaseModel):
    agent_kind: AgentKind | None = Field(default=None, alias="agentKind")
    model_id: str | None = Field(default=None, alias="modelId")


class CreateGatewayCredentialRequest(BaseModel):
    owner_scope: Literal["personal", "organization"] = Field(alias="ownerScope")
    organization_id: UUID | None = Field(default=None, alias="organizationId")
    agent_kind: AgentKind = Field(alias="agentKind")
    display_name: str = Field(alias="displayName")
    policy_kind: Literal["org_byok", "personal_byok"] = Field(alias="policyKind")
    provider_kind: Literal[
        "anthropic_api_key",
        "openai_api_key",
        "gemini_api_key",
        "bedrock_assume_role",
        "openai_compatible",
    ] = Field(alias="providerKind")
    payload: dict[str, str]


class SyncSyncedCredentialEnvRequest(BaseModel):
    auth_mode: Literal["env"] = Field(alias="authMode")
    env_vars: dict[str, str] = Field(alias="envVars")


class SyncSyncedCredentialFileEntry(BaseModel):
    relative_path: str = Field(alias="relativePath")
    content_base64: str = Field(alias="contentBase64")


class SyncSyncedCredentialFileRequest(BaseModel):
    auth_mode: Literal["file"] = Field(alias="authMode")
    files: list[SyncSyncedCredentialFileEntry]


SyncSyncedCredentialRequest = SyncSyncedCredentialEnvRequest | SyncSyncedCredentialFileRequest


class ShareCredentialRequest(BaseModel):
    organization_id: UUID = Field(alias="organizationId")


class SelectAgentAuthCredentialRequest(BaseModel):
    credential_id: UUID = Field(alias="credentialId")
    credential_share_id: UUID | None = Field(default=None, alias="credentialShareId")
    force_restart: bool = Field(default=False, alias="forceRestart")


class AgentAuthMutationResponse(BaseModel):
    ok: bool = True
    changed: bool = False


class SandboxProfileResponse(BaseModel):
    id: UUID
    owner_scope: str = Field(alias="ownerScope")
    owner_user_id: UUID | None = Field(alias="ownerUserId")
    organization_id: UUID | None = Field(alias="organizationId")
    billing_subject_id: UUID = Field(alias="billingSubjectId")
    created_by_user_id: UUID | None = Field(alias="createdByUserId")
    primary_target_id: UUID | None = Field(alias="primaryTargetId")
    desired_agent_auth_revision: int = Field(alias="desiredAgentAuthRevision")
    status: str


class AgentAuthCredentialResponse(BaseModel):
    id: UUID
    owner_scope: str = Field(alias="ownerScope")
    owner_user_id: UUID | None = Field(alias="ownerUserId")
    organization_id: UUID | None = Field(alias="organizationId")
    created_by_user_id: UUID | None = Field(alias="createdByUserId")
    agent_kind: str = Field(alias="agentKind")
    credential_kind: str = Field(alias="credentialKind")
    display_name: str = Field(alias="displayName")
    redacted_summary: dict[str, object] = Field(alias="redactedSummary")
    status: str
    revision: int
    active_credential_share_id: UUID | None = Field(
        default=None,
        alias="activeCredentialShareId",
    )
    revoked_at: str | None = Field(alias="revokedAt")


class AgentAuthCredentialShareResponse(BaseModel):
    id: UUID
    credential_id: UUID = Field(alias="credentialId")
    owner_user_id: UUID = Field(alias="ownerUserId")
    organization_id: UUID = Field(alias="organizationId")
    share_scope: str = Field(alias="shareScope")
    shared_by_user_id: UUID = Field(alias="sharedByUserId")
    status: str
    allowed_agent_kind: str = Field(alias="allowedAgentKind")
    revoked_at: str | None = Field(alias="revokedAt")
    revoked_by_user_id: UUID | None = Field(alias="revokedByUserId")


class AgentGatewayBudgetSubjectResponse(BaseModel):
    id: UUID
    owner_scope: str = Field(alias="ownerScope")
    owner_user_id: UUID | None = Field(alias="ownerUserId")
    organization_id: UUID | None = Field(alias="organizationId")
    litellm_team_id: str | None = Field(alias="litellmTeamId")
    included_budget_usd: str = Field(alias="includedBudgetUsd")
    budget_duration: str | None = Field(alias="budgetDuration")
    entitlement_source: str | None = Field(alias="entitlementSource")
    entitlement_period_key: str | None = Field(alias="entitlementPeriodKey")
    litellm_sync_status: str = Field(alias="litellmSyncStatus")
    status: str
    revision: int
    last_error_code: str | None = Field(alias="lastErrorCode")
    last_error_message: str | None = Field(alias="lastErrorMessage")


class AgentGatewayPolicyResponse(BaseModel):
    id: UUID
    credential_id: UUID = Field(alias="credentialId")
    policy_kind: str = Field(alias="policyKind")
    owner_scope: str = Field(alias="ownerScope")
    owner_user_id: UUID | None = Field(alias="ownerUserId")
    organization_id: UUID | None = Field(alias="organizationId")
    budget_subject_id: UUID | None = Field(alias="budgetSubjectId")
    litellm_team_id: str | None = Field(alias="litellmTeamId")
    litellm_virtual_key_id: str | None = Field(alias="litellmVirtualKeyId")
    litellm_sync_status: str = Field(alias="litellmSyncStatus")
    status: str
    revision: int
    last_error_code: str | None = Field(alias="lastErrorCode")
    last_error_message: str | None = Field(alias="lastErrorMessage")


class AgentGatewayProviderCredentialResponse(BaseModel):
    id: UUID
    policy_id: UUID = Field(alias="policyId")
    provider_kind: str = Field(alias="providerKind")
    redacted_summary: dict[str, object] = Field(alias="redactedSummary")
    validation_status: str = Field(alias="validationStatus")
    validation_error_code: str | None = Field(alias="validationErrorCode")
    validation_error_message: str | None = Field(alias="validationErrorMessage")
    revision: int


class SandboxAgentAuthSelectionResponse(BaseModel):
    id: UUID
    sandbox_profile_id: UUID = Field(alias="sandboxProfileId")
    owner_scope: str = Field(alias="ownerScope")
    agent_kind: str = Field(alias="agentKind")
    credential_id: UUID = Field(alias="credentialId")
    credential_share_id: UUID | None = Field(alias="credentialShareId")
    materialization_mode: str = Field(alias="materializationMode")
    selected_revision: int = Field(alias="selectedRevision")
    status: str
    last_error_code: str | None = Field(alias="lastErrorCode")
    last_error_message: str | None = Field(alias="lastErrorMessage")


class SandboxProfileAgentAuthTargetStateResponse(BaseModel):
    id: UUID
    sandbox_profile_id: UUID = Field(alias="sandboxProfileId")
    target_id: UUID = Field(alias="targetId")
    desired_revision: int = Field(alias="desiredRevision")
    applied_revision: int | None = Field(alias="appliedRevision")
    status: str
    force_restart_required: bool = Field(alias="forceRestartRequired")
    last_command_id: UUID | None = Field(alias="lastCommandId")
    last_worker_id: UUID | None = Field(alias="lastWorkerId")
    last_error_code: str | None = Field(alias="lastErrorCode")
    last_error_message: str | None = Field(alias="lastErrorMessage")


class SyncedCredentialStatus(BaseModel):
    provider: str
    auth_mode: SyncedCredentialAuthMode = Field(serialization_alias="authMode")
    supported: bool
    local_detected: bool = Field(serialization_alias="localDetected")
    synced: bool
    last_synced_at: str | None = Field(default=None, serialization_alias="lastSyncedAt")


class WorkerAgentAuthGatewayConfig(BaseModel):
    protocol_facade: str = Field(alias="protocolFacade")
    base_urls: dict[str, str] = Field(alias="baseUrls")
    runtime_grant_token: str = Field(alias="runtimeGrantToken")
    expires_at: str = Field(alias="expiresAt")
    protected_env: dict[str, str] = Field(default_factory=dict, alias="protectedEnv")
    support_env: dict[str, str] = Field(default_factory=dict, alias="supportEnv")
    protected_config: dict[str, object] = Field(default_factory=dict, alias="protectedConfig")
    support_config: dict[str, object] = Field(default_factory=dict, alias="supportConfig")


class WorkerAgentAuthSyncedFilesConfig(BaseModel):
    credential_share_id: UUID | None = Field(default=None, alias="credentialShareId")
    env_vars: dict[str, str] = Field(default_factory=dict, alias="envVars")
    files: list[dict[str, object]] = Field(default_factory=list)
    cleanup: list[dict[str, object]] = Field(default_factory=list)


class WorkerAgentAuthSelectionPlan(BaseModel):
    agent_kind: str = Field(alias="agentKind")
    materialization_mode: str = Field(alias="materializationMode")
    credential_id: UUID = Field(alias="credentialId")
    credential_revision: int = Field(alias="credentialRevision")
    status: str | None = None
    credential_share_id: UUID | None = Field(default=None, alias="credentialShareId")
    gateway: WorkerAgentAuthGatewayConfig | None = None
    synced_files: WorkerAgentAuthSyncedFilesConfig | None = Field(
        default=None,
        alias="syncedFiles",
    )


class WorkerAgentAuthMaterializationPlan(BaseModel):
    applied: bool = True
    reason: str | None = None
    current_revision: int | None = Field(default=None, alias="currentRevision")
    target_id: UUID | None = Field(default=None, alias="targetId")
    slot_generation: int | None = Field(default=None, alias="slotGeneration")
    sandbox_profile_id: UUID = Field(alias="sandboxProfileId")
    revision: int
    selections: list[WorkerAgentAuthSelectionPlan] = Field(default_factory=list)


class WorkerAgentAuthStatusRequest(BaseModel):
    status: str
    command_id: UUID = Field(alias="commandId")
    revision: int
    lease_id: str = Field(alias="leaseId")
    applied_revision: int | None = Field(default=None, alias="appliedRevision")
    current_revision: int | None = Field(default=None, alias="currentRevision")
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")
    applied_cleanup_paths: list[str] = Field(default_factory=list, alias="appliedCleanupPaths")


class WorkerAgentAuthStatusResponse(BaseModel):
    sandbox_profile_id: UUID = Field(alias="sandboxProfileId")
    target_id: UUID = Field(alias="targetId")
    desired_revision: int = Field(alias="desiredRevision")
    applied_revision: int | None = Field(alias="appliedRevision")
    status: str


class CreateGatewayCredentialResponse(BaseModel):
    credential: AgentAuthCredentialResponse
    policy: AgentGatewayPolicyResponse
    provider_credential: AgentGatewayProviderCredentialResponse = Field(alias="providerCredential")


class SyncSyncedCredentialResponse(BaseModel):
    ok: bool = True
    changed: bool
    credential: AgentAuthCredentialResponse
    selection: SandboxAgentAuthSelectionResponse


class EnsureManagedCreditsResponse(BaseModel):
    budget_subject: AgentGatewayBudgetSubjectResponse = Field(alias="budgetSubject")
    credentials: list[AgentAuthCredentialResponse]
    policies: list[AgentGatewayPolicyResponse]


class AgentGatewayFreeCreditEntitlementResponse(BaseModel):
    id: UUID
    user_id: UUID = Field(alias="userId")
    budget_subject_id: UUID | None = Field(alias="budgetSubjectId")
    source: str
    period_key: str = Field(alias="periodKey")
    included_budget_usd: str = Field(alias="includedBudgetUsd")
    status: str
    activated_at: str | None = Field(alias="activatedAt")
    last_error_code: str | None = Field(alias="lastErrorCode")
    last_error_message: str | None = Field(alias="lastErrorMessage")


class FreeManagedCreditReadyAgentModelResponse(BaseModel):
    agent_kind: str = Field(alias="agentKind")
    public_model_names: list[str] = Field(alias="publicModelNames")
    credential_id: UUID = Field(alias="credentialId")


class EnsureFreeManagedCreditsResponse(BaseModel):
    status: str
    launch_enabled: bool = Field(alias="launchEnabled")
    primary_action: str = Field(alias="primaryAction")
    ready_agent_models: list[FreeManagedCreditReadyAgentModelResponse] = Field(
        alias="readyAgentModels"
    )
    entitlement: AgentGatewayFreeCreditEntitlementResponse | None
    budget_subject: AgentGatewayBudgetSubjectResponse | None = Field(alias="budgetSubject")
    credentials: list[AgentAuthCredentialResponse]
    policies: list[AgentGatewayPolicyResponse]
    last_error_code: str | None = Field(alias="lastErrorCode")
    last_error_message: str | None = Field(alias="lastErrorMessage")


def sandbox_profile_response(record: SandboxProfileRecord) -> SandboxProfileResponse:
    return SandboxProfileResponse(
        id=record.id,
        ownerScope=record.owner_scope,
        ownerUserId=record.owner_user_id,
        organizationId=record.organization_id,
        billingSubjectId=record.billing_subject_id,
        createdByUserId=record.created_by_user_id,
        primaryTargetId=record.primary_target_id,
        desiredAgentAuthRevision=record.desired_agent_auth_revision,
        status=record.status,
    )


def credential_response(
    record: AgentAuthCredentialRecord,
    *,
    active_credential_share_id: UUID | None = None,
) -> AgentAuthCredentialResponse:
    return AgentAuthCredentialResponse(
        id=record.id,
        ownerScope=record.owner_scope,
        ownerUserId=record.owner_user_id,
        organizationId=record.organization_id,
        createdByUserId=record.created_by_user_id,
        agentKind=record.agent_kind,
        credentialKind=record.credential_kind,
        displayName=record.display_name,
        redactedSummary=_json_object(record.redacted_summary_json),
        status=record.status,
        revision=record.revision,
        activeCredentialShareId=active_credential_share_id,
        revokedAt=_iso(record.revoked_at),
    )


def credential_share_response(
    record: AgentAuthCredentialShareRecord,
) -> AgentAuthCredentialShareResponse:
    return AgentAuthCredentialShareResponse(
        id=record.id,
        credentialId=record.credential_id,
        ownerUserId=record.owner_user_id,
        organizationId=record.organization_id,
        shareScope=record.share_scope,
        sharedByUserId=record.shared_by_user_id,
        status=record.status,
        allowedAgentKind=record.allowed_agent_kind,
        revokedAt=_iso(record.revoked_at),
        revokedByUserId=record.revoked_by_user_id,
    )


def budget_subject_response(
    record: AgentGatewayBudgetSubjectRecord,
) -> AgentGatewayBudgetSubjectResponse:
    return AgentGatewayBudgetSubjectResponse(
        id=record.id,
        ownerScope=record.owner_scope,
        ownerUserId=record.owner_user_id,
        organizationId=record.organization_id,
        litellmTeamId=record.litellm_team_id,
        includedBudgetUsd=record.included_budget_usd,
        budgetDuration=record.budget_duration,
        entitlementSource=record.entitlement_source,
        entitlementPeriodKey=record.entitlement_period_key,
        litellmSyncStatus=record.litellm_sync_status,
        status=record.status,
        revision=record.revision,
        lastErrorCode=record.last_error_code,
        lastErrorMessage=record.last_error_message,
    )


def free_credit_entitlement_response(
    record: AgentGatewayFreeCreditEntitlementRecord,
) -> AgentGatewayFreeCreditEntitlementResponse:
    return AgentGatewayFreeCreditEntitlementResponse(
        id=record.id,
        userId=record.user_id,
        budgetSubjectId=record.budget_subject_id,
        source=record.source,
        periodKey=record.period_key,
        includedBudgetUsd=record.included_budget_usd,
        status=record.status,
        activatedAt=_iso(record.activated_at),
        lastErrorCode=record.last_error_code,
        lastErrorMessage=record.last_error_message,
    )


def policy_response(record: AgentGatewayPolicyRecord) -> AgentGatewayPolicyResponse:
    return AgentGatewayPolicyResponse(
        id=record.id,
        credentialId=record.credential_id,
        policyKind=record.policy_kind,
        ownerScope=record.owner_scope,
        ownerUserId=record.owner_user_id,
        organizationId=record.organization_id,
        budgetSubjectId=record.budget_subject_id,
        litellmTeamId=record.litellm_team_id,
        litellmVirtualKeyId=record.litellm_virtual_key_id,
        litellmSyncStatus=record.litellm_sync_status,
        status=record.status,
        revision=record.revision,
        lastErrorCode=record.last_error_code,
        lastErrorMessage=record.last_error_message,
    )


def provider_credential_response(
    record: AgentGatewayProviderCredentialRecord,
) -> AgentGatewayProviderCredentialResponse:
    return AgentGatewayProviderCredentialResponse(
        id=record.id,
        policyId=record.policy_id,
        providerKind=record.provider_kind,
        redactedSummary=_json_object(record.redacted_summary_json),
        validationStatus=record.validation_status,
        validationErrorCode=record.validation_error_code,
        validationErrorMessage=record.validation_error_message,
        revision=record.revision,
    )


def selection_response(
    record: SandboxAgentAuthSelectionRecord,
) -> SandboxAgentAuthSelectionResponse:
    return SandboxAgentAuthSelectionResponse(
        id=record.id,
        sandboxProfileId=record.sandbox_profile_id,
        ownerScope=record.owner_scope,
        agentKind=record.agent_kind,
        credentialId=record.credential_id,
        credentialShareId=record.credential_share_id,
        materializationMode=record.materialization_mode,
        selectedRevision=record.selected_revision,
        status=record.status,
        lastErrorCode=record.last_error_code,
        lastErrorMessage=record.last_error_message,
    )


def target_state_response(
    record: SandboxProfileAgentAuthTargetStateRecord,
) -> SandboxProfileAgentAuthTargetStateResponse:
    return SandboxProfileAgentAuthTargetStateResponse(
        id=record.id,
        sandboxProfileId=record.sandbox_profile_id,
        targetId=record.target_id,
        desiredRevision=record.desired_revision,
        appliedRevision=record.applied_revision,
        status=record.status,
        forceRestartRequired=record.force_restart_required,
        lastCommandId=record.last_command_id,
        lastWorkerId=record.last_worker_id,
        lastErrorCode=record.last_error_code,
        lastErrorMessage=record.last_error_message,
    )


def _json_object(value: str) -> dict[str, object]:
    parsed = json.loads(value or "{}")
    return parsed if isinstance(parsed, dict) else {}


def _iso(value: object) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else None
