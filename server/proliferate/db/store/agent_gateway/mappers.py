"""ORM row → frozen record mappers for the agent-gateway stores."""

from __future__ import annotations

from proliferate.db.models.agent_gateway import (
    AgentApiKey,
    AgentAuthDeliveryAck,
    AgentAuthSelection,
    AgentGatewayEnrollment,
    AgentGatewayEnrollmentKey,
    AgentLlmUsageImportCursor,
    LlmCreditGrant,
    OrgAgentPolicy,
    SeatUsageSample,
)
from proliferate.db.store.agent_gateway.records import (
    AgentApiKeyRecord,
    AgentAuthDeliveryAckRecord,
    AgentAuthSelectionRecord,
    AgentGatewayEnrollmentKeyRecord,
    AgentGatewayEnrollmentRecord,
    AgentLlmUsageImportCursorRecord,
    LlmCreditGrantRecord,
    OrgAgentPolicyRecord,
    SeatUsageSampleRecord,
)


def api_key_record(row: AgentApiKey) -> AgentApiKeyRecord:
    return AgentApiKeyRecord(
        id=row.id,
        user_id=row.user_id,
        title=row.title,
        redacted_hint=row.redacted_hint,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
        kind=row.kind,
    )


def selection_record(row: AgentAuthSelection) -> AgentAuthSelectionRecord:
    return AgentAuthSelectionRecord(
        id=row.id,
        user_id=row.user_id,
        harness_kind=row.harness_kind,
        surface=row.surface,
        source_kind=row.source_kind,
        api_key_id=row.api_key_id,
        env_var_name=row.env_var_name,
        provider_hint=row.provider_hint,
        enabled=row.enabled,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def delivery_ack_record(row: AgentAuthDeliveryAck) -> AgentAuthDeliveryAckRecord:
    return AgentAuthDeliveryAckRecord(
        id=row.id,
        user_id=row.user_id,
        surface=row.surface,
        acked_revision=row.acked_revision,
        acked_fingerprint=row.acked_fingerprint,
        acked_at=row.acked_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def enrollment_record(row: AgentGatewayEnrollment) -> AgentGatewayEnrollmentRecord:
    return AgentGatewayEnrollmentRecord(
        id=row.id,
        subject_kind=row.subject_kind,
        user_id=row.user_id,
        organization_id=row.organization_id,
        billing_subject_id=row.billing_subject_id,
        litellm_team_id=row.litellm_team_id,
        litellm_user_id=row.litellm_user_id,
        virtual_key_id=row.virtual_key_id,
        sync_status=row.sync_status,
        budget_status=row.budget_status,
        sync_fingerprint=row.sync_fingerprint,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
        revoked_at=row.revoked_at,
    )


def enrollment_key_record(row: AgentGatewayEnrollmentKey) -> AgentGatewayEnrollmentKeyRecord:
    return AgentGatewayEnrollmentKeyRecord(
        id=row.id,
        enrollment_id=row.enrollment_id,
        harness_kind=row.harness_kind,
        virtual_key_id=row.virtual_key_id,
        sync_fingerprint=row.sync_fingerprint,
        verification_status=row.verification_status,
        verification_delta=row.verification_delta,
        verified_at=row.verified_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
        revoked_at=row.revoked_at,
    )


def seat_usage_sample_record(row: SeatUsageSample) -> SeatUsageSampleRecord:
    return SeatUsageSampleRecord(
        id=row.id,
        api_key_id=row.api_key_id,
        sampled_at=row.sampled_at,
        util_5h=row.util_5h,
        util_7d=row.util_7d,
        reset_5h=row.reset_5h,
        reset_7d=row.reset_7d,
        binding_window=row.binding_window,
        status=row.status,
    )


def org_agent_policy_record(row: OrgAgentPolicy) -> OrgAgentPolicyRecord:
    return OrgAgentPolicyRecord(
        organization_id=row.organization_id,
        allowed_routes_json=row.allowed_routes_json,
        allowed_harnesses_json=row.allowed_harnesses_json,
        updated_by_user_id=row.updated_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def llm_credit_grant_record(row: LlmCreditGrant) -> LlmCreditGrantRecord:
    return LlmCreditGrantRecord(
        id=row.id,
        billing_subject_id=row.billing_subject_id,
        user_id=row.user_id,
        source=row.source,
        amount_usd=row.amount_usd,
        created_at=row.created_at,
        expires_at=row.expires_at,
        source_ref=row.source_ref,
    )


def usage_import_cursor_record(
    row: AgentLlmUsageImportCursor,
) -> AgentLlmUsageImportCursorRecord:
    return AgentLlmUsageImportCursorRecord(
        id=row.id,
        last_seen_occurred_at=row.last_seen_occurred_at,
        last_polled_at=row.last_polled_at,
        status=row.status,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        metadata_json=row.metadata_json,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
