"""ORM row → frozen record mappers for the agent-gateway stores."""

from __future__ import annotations

from proliferate.db.models.cloud.agent_gateway import (
    AgentApiKey,
    AgentAuthRouteSelection,
    AgentCatalogOverride,
    AgentCatalogSnapshot,
    AgentGatewayEnrollment,
    AgentLlmUsageImportCursor,
    LlmCreditGrant,
    OrgAgentPolicy,
)
from proliferate.db.store.agent_gateway.records import (
    AgentApiKeyRecord,
    AgentAuthRouteSelectionRecord,
    AgentCatalogOverrideRecord,
    AgentCatalogSnapshotRecord,
    AgentGatewayEnrollmentRecord,
    AgentLlmUsageImportCursorRecord,
    LlmCreditGrantRecord,
    OrgAgentPolicyRecord,
)


def api_key_record(row: AgentApiKey) -> AgentApiKeyRecord:
    return AgentApiKeyRecord(
        id=row.id,
        user_id=row.user_id,
        provider=row.provider,
        display_name=row.display_name,
        redacted_hint=row.redacted_hint,
        status=row.status,
        last_validated_at=row.last_validated_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
        revoked_at=row.revoked_at,
    )


def route_selection_record(row: AgentAuthRouteSelection) -> AgentAuthRouteSelectionRecord:
    return AgentAuthRouteSelectionRecord(
        id=row.id,
        user_id=row.user_id,
        harness_kind=row.harness_kind,
        surface=row.surface,
        slot=row.slot,
        route=row.route,
        api_key_id=row.api_key_id,
        revision=row.revision,
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


def catalog_snapshot_record(row: AgentCatalogSnapshot) -> AgentCatalogSnapshotRecord:
    return AgentCatalogSnapshotRecord(
        id=row.id,
        harness_kind=row.harness_kind,
        surface=row.surface,
        route=row.route,
        owner_user_id=row.owner_user_id,
        models_json=row.models_json,
        probed_at=row.probed_at,
        source=row.source,
        status=row.status,
    )


def catalog_override_record(row: AgentCatalogOverride) -> AgentCatalogOverrideRecord:
    return AgentCatalogOverrideRecord(
        id=row.id,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        harness_kind=row.harness_kind,
        patch_json=row.patch_json,
        created_at=row.created_at,
        updated_at=row.updated_at,
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
