"""Cloud agent-auth mappers store operations."""

from __future__ import annotations

from uuid import UUID

from proliferate.db.models.cloud.agent_auth_credentials import (
    AgentAuthCredential,
    AgentAuthCredentialShare,
    SandboxAgentAuthSelection,
)
from proliferate.db.models.cloud.agent_auth_gateway import (
    AgentGatewayBudgetSubject,
    AgentGatewayFreeCreditEntitlement,
    AgentGatewayPolicy,
    AgentGatewayProviderCredential,
    AgentGatewayRuntimeGrant,
)
from proliferate.db.models.cloud.agent_auth_profiles import (
    SandboxProfile,
    SandboxProfileTargetState,
)
from proliferate.db.models.cloud.agent_auth_router import (
    AgentAuthAuditEvent,
    AgentGatewayLlmUsageEvent,
    AgentGatewayRouterMaterialization,
    AgentGatewayUsageImportCursor,
)
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthAuditEventRecord,
    AgentAuthCredentialRecord,
    AgentAuthCredentialShareRecord,
    AgentGatewayBudgetSubjectRecord,
    AgentGatewayFreeCreditEntitlementRecord,
    AgentGatewayLlmUsageEventRecord,
    AgentGatewayPolicyRecord,
    AgentGatewayProviderCredentialRecord,
    AgentGatewayRouterMaterializationRecord,
    AgentGatewayRuntimeGrantRecord,
    AgentGatewayUsageImportCursorRecord,
    SandboxAgentAuthSelectionRecord,
    SandboxProfileRecord,
    SandboxProfileTargetStateRecord,
)

_UNSET = object()


def _profile_record(
    row: SandboxProfile,
    *,
    primary_target_id: UUID | None,
) -> SandboxProfileRecord:
    return SandboxProfileRecord(
        id=row.id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        billing_subject_id=row.billing_subject_id,
        created_by_user_id=row.created_by_user_id,
        primary_target_id=primary_target_id,
        desired_agent_auth_revision=row.desired_agent_auth_revision,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
        archived_at=row.archived_at,
        deleted_at=row.deleted_at,
    )


def _credential_record(row: AgentAuthCredential) -> AgentAuthCredentialRecord:
    return AgentAuthCredentialRecord(
        id=row.id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        created_by_user_id=row.created_by_user_id,
        agent_kind=row.agent_kind,
        credential_kind=row.credential_kind,
        display_name=row.display_name,
        redacted_summary_json=row.redacted_summary_json,
        status=row.status,
        revision=row.revision,
        payload_ciphertext=row.payload_ciphertext,
        payload_ciphertext_key_id=row.payload_ciphertext_key_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        revoked_at=row.revoked_at,
    )


def _share_record(row: AgentAuthCredentialShare) -> AgentAuthCredentialShareRecord:
    return AgentAuthCredentialShareRecord(
        id=row.id,
        credential_id=row.credential_id,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        share_scope=row.share_scope,
        shared_by_user_id=row.shared_by_user_id,
        status=row.status,
        allowed_agent_kind=row.allowed_agent_kind,
        created_at=row.created_at,
        revoked_at=row.revoked_at,
        revoked_by_user_id=row.revoked_by_user_id,
    )


def _budget_subject_record(row: AgentGatewayBudgetSubject) -> AgentGatewayBudgetSubjectRecord:
    return AgentGatewayBudgetSubjectRecord(
        id=row.id,
        budget_kind=row.budget_kind,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        litellm_team_id=row.litellm_team_id,
        included_budget_usd=row.included_budget_usd,
        budget_duration=row.budget_duration,
        entitlement_source=row.entitlement_source,
        entitlement_period_key=row.entitlement_period_key,
        litellm_sync_status=row.litellm_sync_status,
        litellm_sync_fingerprint=row.litellm_sync_fingerprint,
        status=row.status,
        revision=row.revision,
        last_provisioned_at=row.last_provisioned_at,
        last_litellm_reconciled_at=row.last_litellm_reconciled_at,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _free_credit_entitlement_record(
    row: AgentGatewayFreeCreditEntitlement,
) -> AgentGatewayFreeCreditEntitlementRecord:
    return AgentGatewayFreeCreditEntitlementRecord(
        id=row.id,
        user_id=row.user_id,
        budget_subject_id=row.budget_subject_id,
        source=row.source,
        period_key=row.period_key,
        included_budget_usd=row.included_budget_usd,
        status=row.status,
        activated_at=row.activated_at,
        exhausted_at=row.exhausted_at,
        revoked_at=row.revoked_at,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _policy_record(row: AgentGatewayPolicy) -> AgentGatewayPolicyRecord:
    return AgentGatewayPolicyRecord(
        id=row.id,
        credential_id=row.credential_id,
        policy_kind=row.policy_kind,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        budget_subject_id=row.budget_subject_id,
        litellm_team_id=row.litellm_team_id,
        litellm_virtual_key_id=row.litellm_virtual_key_id,
        litellm_virtual_key_ciphertext=row.litellm_virtual_key_ciphertext,
        litellm_virtual_key_ciphertext_key_id=row.litellm_virtual_key_ciphertext_key_id,
        litellm_sync_status=row.litellm_sync_status,
        litellm_sync_fingerprint=row.litellm_sync_fingerprint,
        status=row.status,
        revision=row.revision,
        last_provisioned_at=row.last_provisioned_at,
        last_litellm_reconciled_at=row.last_litellm_reconciled_at,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _provider_credential_record(
    row: AgentGatewayProviderCredential,
) -> AgentGatewayProviderCredentialRecord:
    return AgentGatewayProviderCredentialRecord(
        id=row.id,
        policy_id=row.policy_id,
        provider_kind=row.provider_kind,
        payload_ciphertext=row.payload_ciphertext,
        payload_ciphertext_key_id=row.payload_ciphertext_key_id,
        redacted_summary_json=row.redacted_summary_json,
        validation_status=row.validation_status,
        validated_at=row.validated_at,
        validation_error_code=row.validation_error_code,
        validation_error_message=row.validation_error_message,
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _selection_record(row: SandboxAgentAuthSelection) -> SandboxAgentAuthSelectionRecord:
    return SandboxAgentAuthSelectionRecord(
        id=row.id,
        sandbox_profile_id=row.sandbox_profile_id,
        owner_scope=row.owner_scope,
        agent_kind=row.agent_kind,
        credential_id=row.credential_id,
        credential_share_id=row.credential_share_id,
        materialization_mode=row.materialization_mode,
        selected_revision=row.selected_revision,
        status=row.status,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _target_state_record(
    row: SandboxProfileTargetState,
) -> SandboxProfileTargetStateRecord:
    return SandboxProfileTargetStateRecord(
        id=row.id,
        sandbox_profile_id=row.sandbox_profile_id,
        target_id=row.target_id,
        active_sandbox_id=row.active_sandbox_id,
        slot_generation=row.slot_generation,
        desired_agent_auth_revision=row.desired_agent_auth_revision,
        applied_agent_auth_revision=row.applied_agent_auth_revision,
        agent_auth_status=row.agent_auth_status,
        agent_auth_force_restart_required=row.agent_auth_force_restart_required,
        last_agent_auth_command_id=row.last_agent_auth_command_id,
        last_agent_auth_worker_id=row.last_agent_auth_worker_id,
        last_agent_auth_attempted_at=row.last_agent_auth_attempted_at,
        last_agent_auth_applied_at=row.last_agent_auth_applied_at,
        last_agent_auth_error_code=row.last_agent_auth_error_code,
        last_agent_auth_error_message=row.last_agent_auth_error_message,
        pending_agent_auth_cleanup_json=row.pending_agent_auth_cleanup_json,
        applied_runtime_config_sequence=row.applied_runtime_config_sequence,
        applied_runtime_config_revision_id=row.applied_runtime_config_revision_id,
        runtime_config_status=row.runtime_config_status,
        last_runtime_config_command_id=row.last_runtime_config_command_id,
        last_runtime_config_worker_id=row.last_runtime_config_worker_id,
        last_runtime_config_attempted_at=row.last_runtime_config_attempted_at,
        last_runtime_config_applied_at=row.last_runtime_config_applied_at,
        last_runtime_config_error_code=row.last_runtime_config_error_code,
        last_runtime_config_error_message=row.last_runtime_config_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _runtime_grant_record(row: AgentGatewayRuntimeGrant) -> AgentGatewayRuntimeGrantRecord:
    return AgentGatewayRuntimeGrantRecord(
        id=row.id,
        token_hash=row.token_hash,
        hash_key_id=row.hash_key_id,
        policy_id=row.policy_id,
        credential_id=row.credential_id,
        selection_id=row.selection_id,
        issued_profile_revision=row.issued_profile_revision,
        target_id=row.target_id,
        sandbox_profile_id=row.sandbox_profile_id,
        cloud_sandbox_id=row.cloud_sandbox_id,
        slot_generation=row.slot_generation,
        organization_id=row.organization_id,
        user_id=row.user_id,
        agent_kind=row.agent_kind,
        protocol_facade=row.protocol_facade,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        last_used_at=row.last_used_at,
        created_at=row.created_at,
    )


def _router_materialization_record(
    row: AgentGatewayRouterMaterialization,
) -> AgentGatewayRouterMaterializationRecord:
    return AgentGatewayRouterMaterializationRecord(
        id=row.id,
        router_kind=row.router_kind,
        router_object_kind=row.router_object_kind,
        object_scope=row.object_scope,
        policy_id=row.policy_id,
        provider_credential_id=row.provider_credential_id,
        budget_subject_id=row.budget_subject_id,
        selection_id=row.selection_id,
        sandbox_profile_id=row.sandbox_profile_id,
        target_id=row.target_id,
        cloud_sandbox_id=row.cloud_sandbox_id,
        slot_generation=row.slot_generation,
        agent_kind=row.agent_kind,
        protocol_facade=row.protocol_facade,
        router_object_id=row.router_object_id,
        router_object_secret_ciphertext=row.router_object_secret_ciphertext,
        router_object_secret_ciphertext_key_id=row.router_object_secret_ciphertext_key_id,
        sync_status=row.sync_status,
        sync_fingerprint=row.sync_fingerprint,
        status=row.status,
        last_reconciled_at=row.last_reconciled_at,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _llm_usage_event_record(row: AgentGatewayLlmUsageEvent) -> AgentGatewayLlmUsageEventRecord:
    return AgentGatewayLlmUsageEventRecord(
        id=row.id,
        router_kind=row.router_kind,
        router_log_id=row.router_log_id,
        router_virtual_key_id=row.router_virtual_key_id,
        router_provider_key_id=row.router_provider_key_id,
        materialization_id=row.materialization_id,
        policy_id=row.policy_id,
        budget_subject_id=row.budget_subject_id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        agent_kind=row.agent_kind,
        protocol_facade=row.protocol_facade,
        provider=row.provider,
        model=row.model,
        status=row.status,
        cost_usd=row.cost_usd,
        prompt_tokens=row.prompt_tokens,
        completion_tokens=row.completion_tokens,
        total_tokens=row.total_tokens,
        occurred_at=row.occurred_at,
        imported_at=row.imported_at,
        raw_usage_json=row.raw_usage_json,
    )


def _usage_import_cursor_record(
    row: AgentGatewayUsageImportCursor,
) -> AgentGatewayUsageImportCursorRecord:
    return AgentGatewayUsageImportCursorRecord(
        id=row.id,
        router_kind=row.router_kind,
        last_seen_at=row.last_seen_at,
        last_seen_router_log_id=row.last_seen_router_log_id,
        updated_at=row.updated_at,
    )


def _audit_event_record(row: AgentAuthAuditEvent) -> AgentAuthAuditEventRecord:
    return AgentAuthAuditEventRecord(
        id=row.id,
        action=row.action,
        actor_user_id=row.actor_user_id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        credential_id=row.credential_id,
        sandbox_profile_id=row.sandbox_profile_id,
        target_id=row.target_id,
        metadata_json=row.metadata_json,
        created_at=row.created_at,
    )
