"""Typed records for cloud agent-auth stores."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class SandboxProfileRecord:
    id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    billing_subject_id: UUID
    created_by_user_id: UUID | None
    primary_target_id: UUID | None
    desired_agent_auth_revision: int
    status: str
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None
    deleted_at: datetime | None

    @property
    def agent_auth_revision(self) -> int:
        return self.desired_agent_auth_revision


@dataclass(frozen=True)
class AgentAuthCredentialRecord:
    id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    created_by_user_id: UUID | None
    agent_kind: str
    credential_kind: str
    display_name: str
    redacted_summary_json: str
    status: str
    revision: int
    legacy_cloud_credential_id: UUID | None
    created_at: datetime
    updated_at: datetime
    revoked_at: datetime | None


@dataclass(frozen=True)
class AgentAuthCredentialShareRecord:
    id: UUID
    credential_id: UUID
    owner_user_id: UUID
    organization_id: UUID
    share_scope: str
    shared_by_user_id: UUID
    status: str
    allowed_agent_kind: str
    created_at: datetime
    revoked_at: datetime | None
    revoked_by_user_id: UUID | None


@dataclass(frozen=True)
class AgentGatewayBudgetSubjectRecord:
    id: UUID
    budget_kind: str
    owner_scope: str
    organization_id: UUID
    litellm_team_id: str | None
    included_budget_usd: str
    budget_duration: str
    litellm_sync_status: str
    litellm_sync_fingerprint: str | None
    status: str
    revision: int
    last_provisioned_at: datetime | None
    last_litellm_reconciled_at: datetime | None
    last_error_code: str | None
    last_error_message: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class AgentGatewayPolicyRecord:
    id: UUID
    credential_id: UUID
    policy_kind: str
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    budget_subject_id: UUID | None
    litellm_team_id: str | None
    litellm_virtual_key_id: str | None
    litellm_virtual_key_ciphertext: str | None
    litellm_virtual_key_ciphertext_key_id: str | None
    litellm_sync_status: str
    litellm_sync_fingerprint: str | None
    status: str
    revision: int
    last_provisioned_at: datetime | None
    last_litellm_reconciled_at: datetime | None
    last_error_code: str | None
    last_error_message: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class AgentGatewayProviderCredentialRecord:
    id: UUID
    policy_id: UUID
    provider_kind: str
    payload_ciphertext: str
    payload_ciphertext_key_id: str
    redacted_summary_json: str
    validation_status: str
    validated_at: datetime | None
    validation_error_code: str | None
    validation_error_message: str | None
    revision: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class SandboxAgentAuthSelectionRecord:
    id: UUID
    sandbox_profile_id: UUID
    owner_scope: str
    agent_kind: str
    credential_id: UUID
    credential_share_id: UUID | None
    materialization_mode: str
    selected_revision: int
    status: str
    last_error_code: str | None
    last_error_message: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class SandboxProfileTargetStateRecord:
    id: UUID
    sandbox_profile_id: UUID
    target_id: UUID
    active_sandbox_id: UUID | None
    slot_generation: int | None
    desired_agent_auth_revision: int
    applied_agent_auth_revision: int | None
    agent_auth_status: str
    agent_auth_force_restart_required: bool
    last_agent_auth_command_id: UUID | None
    last_agent_auth_worker_id: UUID | None
    last_agent_auth_attempted_at: datetime | None
    last_agent_auth_applied_at: datetime | None
    last_agent_auth_error_code: str | None
    last_agent_auth_error_message: str | None
    applied_runtime_config_sequence: int
    applied_runtime_config_revision_id: str | None
    runtime_config_status: str
    last_runtime_config_command_id: UUID | None
    last_runtime_config_worker_id: UUID | None
    last_runtime_config_attempted_at: datetime | None
    last_runtime_config_applied_at: datetime | None
    last_runtime_config_error_code: str | None
    last_runtime_config_error_message: str | None
    created_at: datetime
    updated_at: datetime

    @property
    def desired_revision(self) -> int:
        return self.desired_agent_auth_revision

    @property
    def applied_revision(self) -> int | None:
        return self.applied_agent_auth_revision

    @property
    def status(self) -> str:
        return self.agent_auth_status

    @property
    def force_restart_required(self) -> bool:
        return self.agent_auth_force_restart_required

    @property
    def last_command_id(self) -> UUID | None:
        return self.last_agent_auth_command_id

    @property
    def last_worker_id(self) -> UUID | None:
        return self.last_agent_auth_worker_id

    @property
    def last_error_code(self) -> str | None:
        return self.last_agent_auth_error_code

    @property
    def last_error_message(self) -> str | None:
        return self.last_agent_auth_error_message


SandboxProfileAgentAuthTargetStateRecord = SandboxProfileTargetStateRecord


@dataclass(frozen=True)
class AgentGatewayRuntimeGrantRecord:
    id: UUID
    token_hash: str
    hash_key_id: str
    policy_id: UUID
    credential_id: UUID
    selection_id: UUID
    issued_profile_revision: int
    target_id: UUID
    sandbox_profile_id: UUID
    organization_id: UUID | None
    user_id: UUID | None
    agent_kind: str
    protocol_facade: str
    expires_at: datetime
    revoked_at: datetime | None
    last_used_at: datetime | None
    created_at: datetime


@dataclass(frozen=True)
class AgentAuthAuditEventRecord:
    id: UUID
    action: str
    actor_user_id: UUID | None
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    credential_id: UUID | None
    sandbox_profile_id: UUID | None
    target_id: UUID | None
    metadata_json: str
    created_at: datetime


@dataclass(frozen=True)
class LegacyCloudCredentialRecord:
    id: UUID
    provider: str
    auth_mode: str
    revoked_at: datetime | None
    updated_at: datetime | None
