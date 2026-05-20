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
    managed_target_id: UUID | None
    agent_auth_revision: int
    status: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


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
class SandboxProfileAgentAuthTargetStateRecord:
    id: UUID
    sandbox_profile_id: UUID
    target_id: UUID
    desired_revision: int
    applied_revision: int | None
    status: str
    force_restart_required: bool
    last_command_id: UUID | None
    last_worker_id: UUID | None
    last_attempted_at: datetime | None
    last_applied_at: datetime | None
    last_error_code: str | None
    last_error_message: str | None
    created_at: datetime
    updated_at: datetime


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
