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
    AgentGatewayPolicyRecord,
    AgentGatewayProviderCredentialRecord,
    SandboxAgentAuthSelectionRecord,
    SandboxProfileAgentAuthTargetStateRecord,
    SandboxProfileRecord,
)

AgentKind = Literal["claude", "codex", "opencode", "gemini"]
OwnerScope = Literal["personal", "organization"]


class EnsurePersonalSandboxProfileRequest(BaseModel):
    managed_target_id: UUID | None = Field(default=None, alias="managedTargetId")


class EnsureOrganizationSandboxProfileRequest(BaseModel):
    managed_target_id: UUID | None = Field(default=None, alias="managedTargetId")


class LiteLLMModelDeploymentRequest(BaseModel):
    public_model_name: str = Field(alias="publicModelName")
    provider_model: str = Field(alias="providerModel")


class EnsureManagedCreditsRequest(BaseModel):
    included_budget_usd: str | None = Field(default=None, alias="includedBudgetUsd")
    agent_kinds: list[AgentKind] = Field(
        default_factory=lambda: ["claude"], alias="agentKinds"
    )


class CreateGatewayCredentialRequest(BaseModel):
    owner_scope: Literal["personal", "organization"] = Field(alias="ownerScope")
    organization_id: UUID | None = Field(default=None, alias="organizationId")
    agent_kind: AgentKind = Field(alias="agentKind")
    display_name: str = Field(alias="displayName")
    policy_kind: Literal["org_byok", "personal_byok"] = Field(alias="policyKind")
    provider_kind: Literal[
        "anthropic_api_key",
        "openai_api_key",
        "bedrock_assume_role",
        "openai_compatible",
    ] = Field(alias="providerKind")
    payload: dict[str, str]


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
    managed_target_id: UUID | None = Field(alias="managedTargetId")
    agent_auth_revision: int = Field(alias="agentAuthRevision")
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
    legacy_cloud_credential_id: UUID | None = Field(alias="legacyCloudCredentialId")
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
    organization_id: UUID = Field(alias="organizationId")
    litellm_team_id: str | None = Field(alias="litellmTeamId")
    included_budget_usd: str = Field(alias="includedBudgetUsd")
    budget_duration: str = Field(alias="budgetDuration")
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


class CreateGatewayCredentialResponse(BaseModel):
    credential: AgentAuthCredentialResponse
    policy: AgentGatewayPolicyResponse
    provider_credential: AgentGatewayProviderCredentialResponse = Field(alias="providerCredential")


class EnsureManagedCreditsResponse(BaseModel):
    budget_subject: AgentGatewayBudgetSubjectResponse = Field(alias="budgetSubject")
    credentials: list[AgentAuthCredentialResponse]
    policies: list[AgentGatewayPolicyResponse]


def sandbox_profile_response(record: SandboxProfileRecord) -> SandboxProfileResponse:
    return SandboxProfileResponse(
        id=record.id,
        ownerScope=record.owner_scope,
        ownerUserId=record.owner_user_id,
        organizationId=record.organization_id,
        managedTargetId=record.managed_target_id,
        agentAuthRevision=record.agent_auth_revision,
        status=record.status,
    )


def credential_response(record: AgentAuthCredentialRecord) -> AgentAuthCredentialResponse:
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
        legacyCloudCredentialId=record.legacy_cloud_credential_id,
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
        organizationId=record.organization_id,
        litellmTeamId=record.litellm_team_id,
        includedBudgetUsd=record.included_budget_usd,
        budgetDuration=record.budget_duration,
        litellmSyncStatus=record.litellm_sync_status,
        status=record.status,
        revision=record.revision,
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
