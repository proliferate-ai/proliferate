"""Service layer for cloud agent auth."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import secrets
import socket
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import PolicyDenied
from proliferate.config import settings
from proliferate.constants.cloud import (
    AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
    AGENT_GATEWAY_RUNTIME_GRANT_TOKEN_DOMAIN,
    AGENT_GATEWAY_TOKEN_HASH_KEY_ID,
    CloudAgentKind,
    CloudCommandActorKind,
    CloudCommandKind,
    CloudCommandSource,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialRecord,
    AgentAuthCredentialShareRecord,
    AgentGatewayBudgetSubjectRecord,
    AgentGatewayPolicyRecord,
    AgentGatewayProviderCredentialRecord,
    AgentGatewayRuntimeGrantRecord,
    SandboxAgentAuthSelectionRecord,
    SandboxProfileAgentAuthTargetStateRecord,
    SandboxProfileRecord,
)
from proliferate.db.store.cloud_credentials import get_cloud_credential_by_id
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.integrations.aws import (
    AwsIntegrationError,
    validate_bedrock_assume_role_payload,
)
from proliferate.integrations.litellm import LiteLLMAdminClient, LiteLLMIntegrationError
from proliferate.server.cloud.agent_auth.domain.desired_state import (
    LiteLLMModelDeploymentPlan,
    fingerprint_litellm_policy_state,
)
from proliferate.server.cloud.agent_auth.domain.policy import (
    SelectionPlan,
    can_select_credential_for_profile,
    is_supported_agent_kind,
    selection_plan_for_credential,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.models import (
    CreateGatewayCredentialRequest,
    EnsureManagedCreditsRequest,
    LiteLLMModelDeploymentRequest,
    WorkerAgentAuthGatewayConfig,
    WorkerAgentAuthMaterializationPlan,
    WorkerAgentAuthSelectionPlan,
    WorkerAgentAuthStatusRequest,
    WorkerAgentAuthStatusResponse,
    WorkerAgentAuthSyncedFilesConfig,
)
from proliferate.server.cloud.commands.domain.rules import compact_command_json
from proliferate.server.cloud.live.service import publish_command_status_after_commit
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.utils.crypto import decrypt_json, encrypt_json, encrypt_text
from proliferate.utils.time import utcnow

_ORG_ADMIN_ROLES = {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}
_GATEWAY_GRANT_TTL = timedelta(days=7)
_MANAGED_CREDIT_AGENT_KINDS_V1: tuple[CloudAgentKind, ...] = ("claude",)


@dataclass(frozen=True)
class CreateGatewayCredentialResult:
    credential: AgentAuthCredentialRecord
    policy: AgentGatewayPolicyRecord
    provider_credential: AgentGatewayProviderCredentialRecord


@dataclass(frozen=True)
class EnsureManagedCreditsResult:
    budget_subject: AgentGatewayBudgetSubjectRecord
    credentials: tuple[AgentAuthCredentialRecord, ...]
    policies: tuple[AgentGatewayPolicyRecord, ...]


@dataclass(frozen=True)
class CredentialListItem:
    credential: AgentAuthCredentialRecord
    active_share: AgentAuthCredentialShareRecord | None


@dataclass(frozen=True)
class RuntimeGrantIssueResult:
    grant: AgentGatewayRuntimeGrantRecord
    raw_token: str


@dataclass(frozen=True)
class AgentGatewayReconcilePassResult:
    budgets_checked: int
    budgets_reconciled: int
    budgets_failed: int
    policies_checked: int
    policies_reconciled: int
    policies_failed: int


async def ensure_personal_sandbox_profile(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    managed_target_id: UUID | None,
) -> SandboxProfileRecord:
    profile = await store.ensure_personal_sandbox_profile(
        db,
        user_id=actor_user_id,
        managed_target_id=managed_target_id,
    )
    profile = await _backfill_legacy_cloud_credentials(db, actor_user_id, profile)
    await _ensure_profile_target_refresh_if_needed(
        db,
        profile=profile,
        actor_user_id=actor_user_id,
        reason="sandbox_profile_target_attached",
    )
    return profile


async def reconcile_legacy_cloud_credentials_for_user(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    create_profile: bool,
) -> SandboxProfileRecord | None:
    if create_profile:
        profile = await store.ensure_personal_sandbox_profile(
            db,
            user_id=actor_user_id,
            managed_target_id=None,
        )
    else:
        profile = await store.get_active_personal_sandbox_profile_for_user(db, actor_user_id)
        if profile is None:
            return None
    return await _backfill_legacy_cloud_credentials(db, actor_user_id, profile)


async def ensure_organization_sandbox_profile(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
    managed_target_id: UUID | None,
) -> SandboxProfileRecord:
    await _require_organization_admin(db, actor_user_id, organization_id)
    profile = await store.ensure_organization_sandbox_profile(
        db,
        organization_id=organization_id,
        managed_target_id=managed_target_id,
    )
    await _ensure_profile_target_refresh_if_needed(
        db,
        profile=profile,
        actor_user_id=actor_user_id,
        reason="sandbox_profile_target_attached",
    )
    return profile


async def list_credentials(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID | None,
    agent_kind: str | None,
) -> tuple[AgentAuthCredentialRecord, ...]:
    if organization_id is not None:
        await _require_organization_member(db, actor_user_id, organization_id)
    if agent_kind is not None and not is_supported_agent_kind(agent_kind):
        raise AgentAuthError(
            "Unsupported agent kind.", code="unsupported_agent_kind", status_code=400
        )
    return await store.list_visible_credentials(
        db,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
        agent_kind=agent_kind,
    )


async def list_credentials_for_response(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID | None,
    agent_kind: str | None,
) -> tuple[CredentialListItem, ...]:
    credentials = await list_credentials(
        db,
        actor_user_id=actor_user_id,
        organization_id=organization_id,
        agent_kind=agent_kind,
    )
    items: list[CredentialListItem] = []
    for credential in credentials:
        active_share = None
        if (
            organization_id is not None
            and credential.owner_scope == "personal"
            and credential.credential_kind == "synced_path"
        ):
            active_share = await store.get_active_credential_share(
                db,
                credential_id=credential.id,
                organization_id=organization_id,
            )
        items.append(CredentialListItem(credential=credential, active_share=active_share))
    return tuple(items)


async def create_gateway_credential(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    body: CreateGatewayCredentialRequest,
) -> CreateGatewayCredentialResult:
    if body.owner_scope == "organization":
        if body.organization_id is None:
            raise AgentAuthError(
                "organizationId is required.", code="missing_organization_id", status_code=400
            )
        await _require_organization_admin(db, actor_user_id, body.organization_id)
        owner_user_id = None
        organization_id = body.organization_id
    else:
        if body.organization_id is not None:
            raise AgentAuthError(
                "organizationId is not valid for personal credentials.",
                code="invalid_owner_scope",
                status_code=400,
            )
        owner_user_id = actor_user_id
        organization_id = None

    if body.agent_kind == "gemini":
        raise AgentAuthError(
            "Gateway auth is not supported for Gemini in V1.",
            code="gateway_not_supported_for_agent",
            status_code=400,
        )
    _validate_policy_owner_scope(body.policy_kind, body.owner_scope)
    _require_gateway_byok_enabled(body.provider_kind)

    validation = _validate_provider_payload(body.provider_kind, body.payload)
    credential = await store.create_agent_auth_credential(
        db,
        owner_scope=body.owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        created_by_user_id=actor_user_id,
        agent_kind=body.agent_kind,
        credential_kind="managed_gateway",
        display_name=_clean_display_name(body.display_name),
        redacted_summary_json=json.dumps(validation.redacted_summary, sort_keys=True),
        status="pending",
    )
    await store.record_audit_event(
        db,
        action="credential.create",
        actor_user_id=actor_user_id,
        owner_scope=body.owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        credential_id=credential.id,
        metadata_json=json.dumps(
            {
                "agentKind": body.agent_kind,
                "credentialKind": "managed_gateway",
                "providerKind": body.provider_kind,
            },
            sort_keys=True,
        ),
    )
    if validation.status != "valid":
        policy = await store.ensure_gateway_policy(
            db,
            credential_id=credential.id,
            policy_kind=body.policy_kind,
            owner_scope=body.owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            budget_subject_id=None,
            litellm_team_id=None,
            litellm_virtual_key_id=None,
            litellm_virtual_key_ciphertext=None,
            litellm_virtual_key_ciphertext_key_id=None,
            litellm_sync_status="failed",
            litellm_sync_fingerprint=None,
            status="invalid",
            last_error_code=validation.error_code,
            last_error_message=_safe_error_message(validation.error_message, body.payload),
        )
        sync_status = "failed"
        status = "invalid"
        error_code = validation.error_code
        error_message = _safe_error_message(validation.error_message, body.payload)
    else:
        policy, sync_status, status, error_code, error_message = await _provision_policy(
            db,
            credential=credential,
            policy_kind=body.policy_kind,
            owner_scope=body.owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            budget_subject_id=None,
            provider_kind=body.provider_kind,
            provider_payload=body.payload,
            model_deployments=_gateway_deployments_for_credential(
                agent_kind=body.agent_kind,
                provider_kind=body.provider_kind,
            ),
        )
    provider_credential = await store.upsert_provider_credential(
        db,
        policy_id=policy.id,
        provider_kind=body.provider_kind,
        payload_ciphertext=encrypt_json(dict(body.payload)),
        payload_ciphertext_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
        redacted_summary_json=json.dumps(validation.redacted_summary, sort_keys=True),
        validation_status=validation.status,
        validated_at=utcnow() if validation.status == "valid" else None,
        validation_error_code=validation.error_code,
        validation_error_message=_safe_error_message(validation.error_message, body.payload),
    )
    credential = await store.update_credential_status(
        db,
        credential_id=credential.id,
        status="ready" if sync_status == "synced" and status == "ready" else "invalid",
        redacted_summary_json=json.dumps(validation.redacted_summary, sort_keys=True),
    )
    if credential is None:
        raise AgentAuthError("Credential disappeared during creation.", code="credential_missing")
    if error_code is not None:
        await store.record_audit_event(
            db,
            action="credential.validate",
            actor_user_id=actor_user_id,
            owner_scope=body.owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            credential_id=credential.id,
            metadata_json=json.dumps(
                {"status": "failed", "errorCode": error_code, "errorMessage": error_message},
                sort_keys=True,
            ),
        )
    return CreateGatewayCredentialResult(
        credential=credential,
        policy=policy,
        provider_credential=provider_credential,
    )


async def ensure_managed_credits_for_organization(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
    body: EnsureManagedCreditsRequest,
) -> EnsureManagedCreditsResult:
    await _require_organization_admin(db, actor_user_id, organization_id)
    # Customer-facing callers never choose managed-credit amounts. The value
    # comes from Proliferate entitlement/billing state; Phase 1 uses settings as
    # that entitlement source until billing integration wires this internally.
    included_budget_usd = _managed_credit_entitlement_budget()
    existing_budget = await store.get_managed_budget_subject(db, organization_id)
    team_id = existing_budget.litellm_team_id if existing_budget else None
    sync_status = "failed"
    status = "invalid"
    fingerprint = None
    error_code = "litellm_not_configured"
    error_message = "LiteLLM provisioning is not configured."
    requested_agent_kinds = _MANAGED_CREDIT_AGENT_KINDS_V1
    managed_deployments = tuple(
        deployment
        for agent_kind in requested_agent_kinds
        for deployment in _gateway_deployments_for_credential(
            agent_kind=agent_kind,
            provider_kind="proliferate_bedrock_pool",
        )
    )
    if not managed_deployments:
        error_code = "managed_credit_models_not_configured"
        error_message = "No managed-credit model deployments are configured."
    if settings.agent_gateway_enabled and settings.agent_gateway_litellm_master_key:
        try:
            if not managed_deployments:
                raise LiteLLMIntegrationError(error_message)
            client = LiteLLMAdminClient()
            team = await client.ensure_team(
                team_alias=f"org-{organization_id}-managed-credits",
                team_id=team_id,
                max_budget=included_budget_usd,
                budget_duration="30d",
            )
            team_id = team.team_id
            for deployment in managed_deployments:
                # LiteLLM OSS supports team budgets but gates team-scoped model
                # deployments. Managed credits use Proliferate-owned Bedrock
                # credentials, so a global deployment plus team virtual key keeps
                # budget enforcement without mixing customer provider secrets.
                await client.create_model_deployment(
                    public_model_name=deployment.public_model_name,
                    provider_model=deployment.provider_model,
                    litellm_params=_provider_litellm_params(
                        provider_kind="proliferate_bedrock_pool",
                        provider_payload={},
                        deployment=deployment,
                    ),
                    metadata={
                        "organizationId": str(organization_id),
                        "budgetKind": "proliferate_managed",
                    },
                )
            sync_status = "synced"
            status = "ready"
            fingerprint = _deployment_fingerprint(
                policy_kind="proliferate_managed",
                litellm_team_id=team_id,
                budget_subject_id=str(existing_budget.id) if existing_budget else None,
                provider_kind="proliferate_bedrock_pool",
                deployments=managed_deployments,
            )
            error_code = None
            error_message = None
        except LiteLLMIntegrationError as exc:
            error_code = "litellm_provisioning_failed"
            error_message = _safe_error_message(str(exc), {})
    budget = await store.ensure_managed_budget_subject(
        db,
        organization_id=organization_id,
        included_budget_usd=included_budget_usd,
        litellm_team_id=team_id,
        litellm_sync_status=sync_status,
        litellm_sync_fingerprint=fingerprint,
        status=status,
        last_error_code=error_code,
        last_error_message=error_message,
    )

    credentials: list[AgentAuthCredentialRecord] = []
    policies: list[AgentGatewayPolicyRecord] = []
    for agent_kind in requested_agent_kinds:
        if not _gateway_deployments_for_credential(
            agent_kind=agent_kind,
            provider_kind="proliferate_bedrock_pool",
        ):
            continue
        credential = await store.get_managed_gateway_credential(
            db,
            organization_id=organization_id,
            agent_kind=agent_kind,
        )
        if credential is None:
            credential = await store.create_agent_auth_credential(
                db,
                owner_scope="organization",
                owner_user_id=None,
                organization_id=organization_id,
                created_by_user_id=actor_user_id,
                agent_kind=agent_kind,
                credential_kind="managed_gateway",
                display_name="Proliferate managed credits",
                redacted_summary_json=json.dumps(
                    {
                        "providerKind": "proliferate_bedrock_pool",
                        "budgetSubjectId": str(budget.id),
                    },
                    sort_keys=True,
                ),
                status="ready" if status == "ready" else "invalid",
            )
        policy = await _ensure_managed_policy(
            db,
            credential=credential,
            budget=budget,
            sync_status=sync_status,
            status=status,
            fingerprint=fingerprint,
            error_code=error_code,
            error_message=error_message,
        )
        credential = (
            await store.update_credential_status(
                db,
                credential_id=credential.id,
                status="ready" if policy.status == "ready" else "invalid",
            )
            or credential
        )
        credentials.append(credential)
        policies.append(policy)
    await store.record_audit_event(
        db,
        action="managed_credits.ensure",
        actor_user_id=actor_user_id,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization_id,
        metadata_json=json.dumps(
            {
                "includedBudgetUsd": included_budget_usd,
                "agentKinds": list(requested_agent_kinds),
                "litellmSyncStatus": sync_status,
            },
            sort_keys=True,
        ),
    )
    return EnsureManagedCreditsResult(
        budget_subject=budget,
        credentials=tuple(credentials),
        policies=tuple(policies),
    )


async def reconcile_agent_gateway_litellm_mirror(
    db: AsyncSession,
    *,
    limit: int = 50,
) -> AgentGatewayReconcilePassResult:
    if limit <= 0:
        return AgentGatewayReconcilePassResult(
            budgets_checked=0,
            budgets_reconciled=0,
            budgets_failed=0,
            policies_checked=0,
            policies_reconciled=0,
            policies_failed=0,
        )
    if not settings.agent_gateway_enabled or not settings.agent_gateway_litellm_master_key:
        return AgentGatewayReconcilePassResult(
            budgets_checked=0,
            budgets_reconciled=0,
            budgets_failed=0,
            policies_checked=0,
            policies_reconciled=0,
            policies_failed=0,
        )

    budgets = await store.list_managed_budget_subjects_for_reconciliation(
        db,
        limit=limit,
    )
    budgets_reconciled = 0
    budgets_failed = 0
    for budget in budgets:
        reconciled_budget = await _reconcile_managed_budget_subject(db, budget=budget)
        if reconciled_budget.litellm_sync_status == "synced" and reconciled_budget.status in {
            "ready",
            "exhausted",
        }:
            budgets_reconciled += 1
        else:
            budgets_failed += 1

    policies = await store.list_gateway_policies_for_reconciliation(
        db,
        limit=limit,
    )
    policies_reconciled = 0
    policies_failed = 0
    for policy in policies:
        reconciled_policy = await _reconcile_gateway_policy(db, policy=policy)
        if (
            reconciled_policy.status == "ready"
            and reconciled_policy.litellm_sync_status == "synced"
        ):
            policies_reconciled += 1
        else:
            policies_failed += 1

    return AgentGatewayReconcilePassResult(
        budgets_checked=len(budgets),
        budgets_reconciled=budgets_reconciled,
        budgets_failed=budgets_failed,
        policies_checked=len(policies),
        policies_reconciled=policies_reconciled,
        policies_failed=policies_failed,
    )


async def share_personal_credential_with_organization(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    credential_id: UUID,
    organization_id: UUID,
) -> AgentAuthCredentialShareRecord:
    await _require_organization_member(db, actor_user_id, organization_id)
    credential = await store.get_credential(db, credential_id)
    if credential is None or credential.revoked_at is not None:
        raise AgentAuthError("Credential not found.", code="credential_not_found", status_code=404)
    if credential.owner_scope != "personal" or credential.owner_user_id != actor_user_id:
        raise AgentAuthError(
            "Only the credential owner can share this credential.",
            code="credential_share_forbidden",
            status_code=403,
        )
    if credential.credential_kind != "synced_path":
        raise AgentAuthError(
            "Only synced-path credentials can be shared in V1.",
            code="credential_share_not_supported",
            status_code=400,
        )
    share = await store.create_or_reactivate_credential_share(
        db,
        credential_id=credential.id,
        owner_user_id=actor_user_id,
        organization_id=organization_id,
        shared_by_user_id=actor_user_id,
        allowed_agent_kind=credential.agent_kind,
    )
    await store.record_audit_event(
        db,
        action="credential.share",
        actor_user_id=actor_user_id,
        owner_scope="personal",
        owner_user_id=actor_user_id,
        organization_id=organization_id,
        credential_id=credential.id,
        metadata_json=json.dumps({"shareId": str(share.id)}, sort_keys=True),
    )
    return share


async def revoke_credential_share(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    share_id: UUID,
) -> AgentAuthCredentialShareRecord:
    existing = await store.get_credential_share(db, share_id)
    if existing is None:
        raise AgentAuthError(
            "Credential share not found.", code="credential_share_not_found", status_code=404
        )
    if existing.owner_user_id != actor_user_id:
        raise AgentAuthError(
            "Only the credential owner can revoke this share.",
            code="credential_share_forbidden",
            status_code=403,
        )
    share = await store.revoke_credential_share(
        db,
        share_id=share_id,
        revoked_by_user_id=actor_user_id,
    )
    if share is None:
        raise AgentAuthError(
            "Credential share not found.", code="credential_share_not_found", status_code=404
        )
    affected = await store.list_active_selections_for_credential_or_share(
        db,
        credential_share_id=share.id,
    )
    for selection in affected:
        await store.mark_selection_invalid(
            db,
            selection_id=selection.id,
            error_code="credential_share_revoked",
            error_message="Credential owner revoked the share.",
        )
        await _bump_profile_for_selection(
            db,
            selection,
            actor_user_id=actor_user_id,
            reason="credential_share_revoked",
            force_restart=True,
        )
    await store.record_audit_event(
        db,
        action="credential_share.revoke",
        actor_user_id=actor_user_id,
        owner_scope="personal",
        owner_user_id=share.owner_user_id,
        organization_id=share.organization_id,
        credential_id=share.credential_id,
        metadata_json=json.dumps({"shareId": str(share.id)}, sort_keys=True),
    )
    return share


async def revoke_credential(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    credential_id: UUID,
) -> AgentAuthCredentialRecord:
    credential = await store.get_credential(db, credential_id)
    if credential is None:
        raise AgentAuthError("Credential not found.", code="credential_not_found", status_code=404)
    await _require_can_manage_credential(db, actor_user_id, credential)
    revoked = await store.revoke_credential(db, credential_id=credential_id)
    if revoked is None:
        raise AgentAuthError("Credential not found.", code="credential_not_found", status_code=404)
    affected = await store.list_active_selections_for_credential_or_share(
        db,
        credential_id=credential_id,
    )
    for selection in affected:
        await store.mark_selection_invalid(
            db,
            selection_id=selection.id,
            error_code="credential_revoked",
            error_message="Selected credential was revoked.",
        )
        await _bump_profile_for_selection(
            db,
            selection,
            actor_user_id=actor_user_id,
            reason="credential_revoked",
            force_restart=True,
        )
    await store.record_audit_event(
        db,
        action="credential.revoke",
        actor_user_id=actor_user_id,
        owner_scope=credential.owner_scope,
        owner_user_id=credential.owner_user_id,
        organization_id=credential.organization_id,
        credential_id=credential.id,
    )
    return revoked


async def list_selections(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    sandbox_profile_id: UUID,
) -> tuple[SandboxAgentAuthSelectionRecord, ...]:
    profile = await _require_profile_access(db, actor_user_id, sandbox_profile_id, admin=False)
    return await store.list_selections_for_profile(db, profile.id)


async def select_credential_for_profile(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    sandbox_profile_id: UUID,
    agent_kind: CloudAgentKind,
    credential_id: UUID,
    credential_share_id: UUID | None,
    force_restart: bool,
) -> SandboxAgentAuthSelectionRecord:
    profile = await _require_profile_access(db, actor_user_id, sandbox_profile_id, admin=True)
    credential = await store.get_credential(db, credential_id)
    if credential is None or credential.revoked_at is not None:
        raise AgentAuthError("Credential not found.", code="credential_not_found", status_code=404)
    if credential.agent_kind != agent_kind:
        raise AgentAuthError(
            "Credential is for a different agent kind.",
            code="agent_kind_mismatch",
            status_code=400,
        )
    await _require_credential_ready_for_selection(db, credential)
    share = None
    if credential_share_id is not None:
        share = await store.get_active_credential_share(
            db,
            credential_id=credential.id,
            organization_id=profile.organization_id or UUID(int=0),
        )
        if share is None or share.id != credential_share_id:
            raise AgentAuthError(
                "Credential share is not active.",
                code="credential_share_required",
                status_code=403,
            )
    has_active_share = share is not None
    verdict = can_select_credential_for_profile(
        profile_owner_scope=profile.owner_scope,
        profile_owner_user_id=profile.owner_user_id,
        profile_organization_id=profile.organization_id,
        credential_owner_scope=credential.owner_scope,
        credential_owner_user_id=credential.owner_user_id,
        credential_organization_id=credential.organization_id,
        credential_kind=credential.credential_kind,
        has_active_share=has_active_share,
    )
    if isinstance(verdict, PolicyDenied):
        raise AgentAuthError(verdict.message, code=verdict.code, status_code=verdict.status_code)
    plan = selection_plan_for_credential(
        agent_kind=agent_kind,
        credential_kind=credential.credential_kind,
    )
    if not isinstance(plan, SelectionPlan):
        raise AgentAuthError(plan.message, code=plan.code, status_code=plan.status_code)
    if (
        agent_kind == "opencode"
        and plan.materialization_mode == "gateway_env"
        and not settings.agent_gateway_opencode_enabled
    ):
        raise AgentAuthError(
            "Gateway auth for OpenCode is not enabled.",
            code="gateway_not_supported_for_agent",
            status_code=400,
        )
    selection = await store.upsert_selection(
        db,
        sandbox_profile_id=profile.id,
        owner_scope=profile.owner_scope,
        agent_kind=agent_kind,
        credential_id=credential.id,
        credential_share_id=share.id if share is not None else None,
        materialization_mode=plan.materialization_mode,
        selected_revision=credential.revision,
        status="active",
        last_error_code=None,
        last_error_message=None,
    )
    updated_profile = await store.bump_sandbox_profile_agent_auth_revision(
        db,
        sandbox_profile_id=profile.id,
        reason="selection_changed",
        actor_user_id=actor_user_id,
        force_restart=force_restart,
    )
    if updated_profile is None:
        raise AgentAuthError(
            "Sandbox profile not found.", code="sandbox_profile_not_found", status_code=404
        )
    await _mark_target_pending_and_queue_refresh(
        db,
        profile=updated_profile,
        actor_user_id=actor_user_id,
        reason="selection_changed",
        force_restart=force_restart,
    )
    await store.record_audit_event(
        db,
        action="selection.write",
        actor_user_id=actor_user_id,
        owner_scope=profile.owner_scope,
        owner_user_id=profile.owner_user_id,
        organization_id=profile.organization_id,
        credential_id=credential.id,
        sandbox_profile_id=profile.id,
        metadata_json=json.dumps(
            {
                "agentKind": agent_kind,
                "credentialShareId": str(share.id) if share else None,
                "forceRestart": force_restart,
                "revision": updated_profile.agent_auth_revision,
            },
            sort_keys=True,
        ),
    )
    return selection


async def list_target_states(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    sandbox_profile_id: UUID,
) -> tuple[SandboxProfileAgentAuthTargetStateRecord, ...]:
    profile = await _require_profile_access(db, actor_user_id, sandbox_profile_id, admin=False)
    return await store.list_target_states_for_profile(db, profile.id)


async def issue_runtime_grant_for_selection(
    db: AsyncSession,
    *,
    selection: SandboxAgentAuthSelectionRecord,
    profile: SandboxProfileRecord,
    target_id: UUID,
) -> RuntimeGrantIssueResult:
    if selection.status != "active":
        raise AgentAuthError(
            "Selection is not active.", code="selection_not_active", status_code=409
        )
    credential = await store.get_credential(db, selection.credential_id)
    if credential is None or credential.revoked_at is not None:
        raise AgentAuthError("Credential not found.", code="credential_not_found", status_code=404)
    if selection.selected_revision != credential.revision:
        raise AgentAuthError(
            "Selection is stale.", code="selection_revision_stale", status_code=409
        )
    await _require_credential_ready_for_selection(db, credential)
    policy = await store.get_gateway_policy_for_credential(db, credential.id)
    if policy is None or policy.status != "ready" or policy.litellm_sync_status != "synced":
        raise AgentAuthError(
            "Gateway policy is not ready.", code="gateway_policy_not_ready", status_code=409
        )
    plan = selection_plan_for_credential(
        agent_kind=selection.agent_kind,
        credential_kind=credential.credential_kind,
    )
    if not isinstance(plan, SelectionPlan) or plan.protocol_facade is None:
        raise AgentAuthError(
            "Selection does not use gateway auth.", code="not_gateway_selection", status_code=400
        )
    if selection.agent_kind == "opencode" and not settings.agent_gateway_opencode_enabled:
        raise AgentAuthError(
            "Gateway auth for OpenCode is not enabled.",
            code="gateway_not_supported_for_agent",
            status_code=400,
        )

    now = utcnow()
    await store.lock_runtime_grant_route(
        db,
        policy_id=policy.id,
        target_id=target_id,
        sandbox_profile_id=profile.id,
        agent_kind=selection.agent_kind,
    )
    existing = await store.list_active_runtime_grants_for_route(
        db,
        policy_id=policy.id,
        target_id=target_id,
        sandbox_profile_id=profile.id,
        agent_kind=selection.agent_kind,
        now=now,
    )
    # The raw token is intentionally not persisted. Materialization retries get
    # a fresh overlapping grant, but keep only the newest prior grant as a
    # short compatibility grace token for already-configured runtimes.
    stale_grant_ids = {grant.id for grant in existing[1:]}
    await store.revoke_runtime_grants_by_ids(db, stale_grant_ids)

    raw_token = secrets.token_urlsafe(32)
    grant = await store.create_runtime_grant(
        db,
        token_hash=_hash_token(raw_token),
        hash_key_id=AGENT_GATEWAY_TOKEN_HASH_KEY_ID,
        policy_id=policy.id,
        credential_id=credential.id,
        selection_id=selection.id,
        issued_profile_revision=profile.agent_auth_revision,
        target_id=target_id,
        sandbox_profile_id=profile.id,
        organization_id=profile.organization_id,
        user_id=profile.owner_user_id,
        agent_kind=selection.agent_kind,
        protocol_facade=plan.protocol_facade,
        expires_at=now + _GATEWAY_GRANT_TTL,
    )
    return RuntimeGrantIssueResult(grant=grant, raw_token=raw_token)


async def worker_agent_auth_materialization_plan(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    sandbox_profile_id: UUID,
    command_id: UUID,
    revision: int,
    lease_id: str,
) -> WorkerAgentAuthMaterializationPlan:
    command = await _require_agent_auth_refresh_command(
        db,
        auth=auth,
        sandbox_profile_id=sandbox_profile_id,
        command_id=command_id,
        revision=revision,
        lease_id=lease_id,
    )
    profile = await store.get_sandbox_profile(db, sandbox_profile_id)
    if profile is None:
        raise AgentAuthError(
            "Sandbox profile not found.",
            code="sandbox_profile_not_found",
            status_code=404,
        )
    if revision < profile.agent_auth_revision:
        return WorkerAgentAuthMaterializationPlan(
            applied=False,
            reason="superseded",
            currentRevision=profile.agent_auth_revision,
            targetId=auth.target_id,
            sandboxProfileId=profile.id,
            revision=revision,
            selections=[],
        )
    if revision != profile.agent_auth_revision:
        raise AgentAuthError(
            "Requested agent-auth revision does not match the profile.",
            code="agent_auth_revision_mismatch",
            status_code=409,
        )
    await _require_agent_auth_target_state(
        db,
        profile=profile,
        auth=auth,
        command=command,
    )
    selections = []
    for selection in await store.list_selections_for_profile(db, profile.id):
        if selection.status != "active":
            continue
        selections.append(
            await _worker_selection_plan(
                db,
                auth=auth,
                profile=profile,
                selection=selection,
            )
        )
    return WorkerAgentAuthMaterializationPlan(
        applied=True,
        reason=None,
        currentRevision=profile.agent_auth_revision,
        targetId=auth.target_id,
        sandboxProfileId=profile.id,
        revision=revision,
        selections=selections,
    )


async def record_worker_agent_auth_status(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    sandbox_profile_id: UUID,
    body: WorkerAgentAuthStatusRequest,
) -> WorkerAgentAuthStatusResponse:
    command = await _require_agent_auth_refresh_command(
        db,
        auth=auth,
        sandbox_profile_id=sandbox_profile_id,
        command_id=body.command_id,
        revision=body.revision,
        lease_id=body.lease_id,
    )
    if body.status not in {"materializing", "applied", "superseded", "failed"}:
        raise AgentAuthError(
            "Agent auth status is invalid.",
            code="agent_auth_status_invalid",
            status_code=400,
        )
    profile = await store.get_sandbox_profile(db, sandbox_profile_id)
    if profile is None:
        raise AgentAuthError(
            "Sandbox profile not found.",
            code="sandbox_profile_not_found",
            status_code=404,
        )
    _validate_worker_status_revisions(body, profile)
    await _require_agent_auth_target_state(
        db,
        profile=profile,
        auth=auth,
        command=command,
    )
    existing = await store.get_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=auth.target_id,
    )
    existing_applied = existing.applied_revision if existing is not None else None
    desired_revision = max(profile.agent_auth_revision, body.current_revision or body.revision)
    applied_revision = existing_applied
    status = body.status
    error_code = None
    error_message = None
    if body.status == "applied":
        applied_revision = (
            body.applied_revision if body.applied_revision is not None else body.revision
        )
        if applied_revision < desired_revision:
            status = "superseded"
        else:
            desired_revision = applied_revision
    elif body.status == "superseded":
        status = "superseded"
    elif body.status == "failed":
        error_code = body.error_code or "agent_auth_materialization_failed"
        error_message = _worker_status_error_message(error_code)
    if applied_revision is not None and applied_revision > desired_revision:
        desired_revision = applied_revision
    force_restart_required = existing.force_restart_required if existing is not None else False
    if status == "applied" and applied_revision == desired_revision:
        force_restart_required = False
    state = await store.upsert_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=auth.target_id,
        desired_revision=desired_revision,
        applied_revision=applied_revision,
        status=status,
        force_restart_required=force_restart_required,
        last_command_id=body.command_id,
        last_worker_id=auth.worker_id,
        last_error_code=error_code,
        last_error_message=error_message,
    )
    return WorkerAgentAuthStatusResponse(
        sandboxProfileId=profile.id,
        targetId=auth.target_id,
        desiredRevision=state.desired_revision,
        appliedRevision=state.applied_revision,
        status=state.status,
    )


def _validate_worker_status_revisions(
    body: WorkerAgentAuthStatusRequest,
    profile: SandboxProfileRecord,
) -> None:
    current_revision = body.current_revision
    applied_revision = body.applied_revision
    if current_revision is not None and current_revision > profile.agent_auth_revision:
        raise AgentAuthError(
            "Worker reported an unknown agent-auth revision.",
            code="agent_auth_revision_mismatch",
            status_code=409,
        )
    if applied_revision is not None and applied_revision > profile.agent_auth_revision:
        raise AgentAuthError(
            "Worker reported an unknown applied agent-auth revision.",
            code="agent_auth_revision_mismatch",
            status_code=409,
        )


def _worker_status_error_message(error_code: str) -> str:
    return f"Agent auth materialization failed ({error_code})."


async def _require_agent_auth_refresh_command(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    sandbox_profile_id: UUID,
    command_id: UUID,
    revision: int,
    lease_id: str,
) -> commands_store.CloudCommandSnapshot:
    command = await commands_store.get_command_by_id(db, command_id)
    if (
        command is None
        or command.target_id != auth.target_id
        or command.leased_by_worker_id != auth.worker_id
        or command.kind != CloudCommandKind.refresh_agent_auth_config.value
        or command.status != CloudCommandStatus.leased.value
        or command.lease_id != lease_id
    ):
        raise AgentAuthError(
            "Agent auth config command is not leased by this worker.",
            code="agent_auth_command_not_found",
            status_code=404,
        )
    try:
        payload = json.loads(command.payload_json)
    except json.JSONDecodeError as exc:
        raise AgentAuthError(
            "Agent auth config command payload is invalid.",
            code="agent_auth_command_invalid",
            status_code=409,
        ) from exc
    if not isinstance(payload, dict) or payload.get("sandboxProfileId") != str(sandbox_profile_id):
        raise AgentAuthError(
            "Agent auth config command does not match the requested profile.",
            code="agent_auth_command_mismatch",
            status_code=409,
        )
    if payload.get("revision") != revision:
        raise AgentAuthError(
            "Agent auth config command does not match the requested revision.",
            code="agent_auth_command_mismatch",
            status_code=409,
        )
    return command


async def _require_agent_auth_target_state(
    db: AsyncSession,
    *,
    profile: SandboxProfileRecord,
    auth: WorkerAuthContext,
    command: commands_store.CloudCommandSnapshot,
) -> SandboxProfileAgentAuthTargetStateRecord:
    state = await store.get_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=auth.target_id,
    )
    if state is None or state.last_command_id != command.id:
        raise AgentAuthError(
            "Agent auth config command is not current for this profile and target.",
            code="agent_auth_command_mismatch",
            status_code=409,
        )
    return state


async def _worker_selection_plan(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    profile: SandboxProfileRecord,
    selection: SandboxAgentAuthSelectionRecord,
) -> WorkerAgentAuthSelectionPlan:
    credential = await store.get_credential(db, selection.credential_id)
    if credential is None or credential.revoked_at is not None:
        raise AgentAuthError("Credential not found.", code="credential_not_found", status_code=404)
    if selection.selected_revision != credential.revision:
        raise AgentAuthError(
            "Selection is stale.",
            code="selection_revision_stale",
            status_code=409,
        )
    await _require_credential_ready_for_selection(db, credential)
    if selection.materialization_mode == "gateway_env":
        gateway = await _worker_gateway_config(
            db,
            auth=auth,
            profile=profile,
            selection=selection,
        )
        return WorkerAgentAuthSelectionPlan(
            agentKind=selection.agent_kind,
            materializationMode=selection.materialization_mode,
            credentialId=credential.id,
            credentialRevision=credential.revision,
            credentialShareId=selection.credential_share_id,
            gateway=gateway,
            syncedFiles=None,
        )
    if selection.materialization_mode == "synced_files":
        synced_files = await _worker_synced_files_config(db, credential, selection)
        return WorkerAgentAuthSelectionPlan(
            agentKind=selection.agent_kind,
            materializationMode=selection.materialization_mode,
            credentialId=credential.id,
            credentialRevision=credential.revision,
            credentialShareId=selection.credential_share_id,
            gateway=None,
            syncedFiles=synced_files,
        )
    raise AgentAuthError(
        "Unsupported materialization mode.",
        code="unsupported_materialization_mode",
        status_code=400,
    )


async def _worker_gateway_config(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    profile: SandboxProfileRecord,
    selection: SandboxAgentAuthSelectionRecord,
) -> WorkerAgentAuthGatewayConfig:
    result = await issue_runtime_grant_for_selection(
        db,
        selection=selection,
        profile=profile,
        target_id=auth.target_id,
    )
    base = _gateway_base_url()
    if selection.agent_kind == "claude":
        facade_base = f"{base}/anthropic"
        return WorkerAgentAuthGatewayConfig(
            protocolFacade="anthropic",
            baseUrls={"anthropic": facade_base},
            runtimeGrantToken=result.raw_token,
            expiresAt=result.grant.expires_at.isoformat(),
            protectedEnv={
                "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST": "1",
                "ANTHROPIC_BASE_URL": facade_base,
                "ANTHROPIC_CUSTOM_HEADERS": f"Authorization: Bearer {result.raw_token}",
                "ANTHROPIC_AUTH_TOKEN": "",
            },
            supportEnv={},
            protectedConfig={},
            supportConfig={},
        )
    if selection.agent_kind == "codex":
        facade_base = f"{base}/openai/v1"
        return WorkerAgentAuthGatewayConfig(
            protocolFacade="openai",
            baseUrls={"openai": facade_base},
            runtimeGrantToken=result.raw_token,
            expiresAt=result.grant.expires_at.isoformat(),
            protectedEnv={"CODEX_API_KEY": result.raw_token},
            supportEnv={},
            protectedConfig={
                "codex": {
                    "model_provider_id": "proliferate",
                    "model_providers": {
                        "proliferate": {
                            "name": "Proliferate Gateway",
                            "base_url": facade_base,
                            "env_key": "CODEX_API_KEY",
                            "wire_api": "responses",
                            "requires_openai_auth": False,
                        }
                    },
                }
            },
            supportConfig={},
        )
    if selection.agent_kind == "opencode":
        facade_base = f"{base}/openai/v1"
        return WorkerAgentAuthGatewayConfig(
            protocolFacade="openai",
            baseUrls={"openai": facade_base},
            runtimeGrantToken=result.raw_token,
            expiresAt=result.grant.expires_at.isoformat(),
            protectedEnv={
                "OPENAI_API_KEY": result.raw_token,
                "OPENAI_BASE_URL": facade_base,
            },
            supportEnv={},
            protectedConfig={},
            supportConfig={},
        )
    raise AgentAuthError(
        "Gateway auth is not supported for this agent.",
        code="gateway_not_supported_for_agent",
        status_code=400,
    )


async def _worker_synced_files_config(
    db: AsyncSession,
    credential: AgentAuthCredentialRecord,
    selection: SandboxAgentAuthSelectionRecord,
) -> WorkerAgentAuthSyncedFilesConfig:
    if credential.legacy_cloud_credential_id is None:
        raise AgentAuthError(
            "Synced credential is missing its source credential.",
            code="synced_credential_source_missing",
            status_code=409,
        )
    legacy = await get_cloud_credential_by_id(db, credential.legacy_cloud_credential_id)
    if legacy is None or legacy.revoked_at is not None or legacy.provider != credential.agent_kind:
        raise AgentAuthError(
            "Synced credential source is not active.",
            code="synced_credential_source_missing",
            status_code=409,
        )
    payload = decrypt_json(legacy.payload_ciphertext)
    if not isinstance(payload, dict):
        raise AgentAuthError(
            "Synced credential payload is invalid.",
            code="synced_credential_payload_invalid",
            status_code=409,
        )
    raw_env_vars = payload.get("envVars")
    env_vars = {
        key: value
        for key, value in (raw_env_vars if isinstance(raw_env_vars, dict) else {}).items()
        if isinstance(key, str) and isinstance(value, str)
    }
    raw_files = payload.get("files")
    files = [
        {"relativePath": relative_path, "content": content}
        for relative_path, content in (raw_files if isinstance(raw_files, dict) else {}).items()
        if isinstance(relative_path, str) and isinstance(content, str)
    ]
    if not env_vars and not files:
        raise AgentAuthError(
            "Synced credential payload is empty.",
            code="synced_credential_payload_invalid",
            status_code=409,
        )
    return WorkerAgentAuthSyncedFilesConfig(
        credentialShareId=selection.credential_share_id,
        envVars=env_vars,
        files=files,
        cleanup=[],
    )


def _gateway_base_url() -> str:
    base = settings.agent_gateway_public_base_url.strip().rstrip("/")
    if not base:
        raise AgentAuthError(
            "Agent gateway public base URL is not configured.",
            code="agent_gateway_public_base_url_missing",
            status_code=409,
        )
    return base


async def _backfill_legacy_cloud_credentials(
    db: AsyncSession,
    actor_user_id: UUID,
    profile: SandboxProfileRecord,
) -> SandboxProfileRecord:
    all_legacy_rows = await store.list_legacy_cloud_credentials_for_user(db, actor_user_id)
    active_legacy_by_id = {row.id: row for row in all_legacy_rows if row.revoked_at is None}
    imported_legacy_credentials = await store.list_imported_legacy_credentials_for_user(
        db,
        actor_user_id,
    )
    imported_credential_ids = {credential.id for credential in imported_legacy_credentials}
    changed = False
    for imported in imported_legacy_credentials:
        legacy = next(
            (row for row in all_legacy_rows if row.id == imported.legacy_cloud_credential_id),
            None,
        )
        if legacy is None or legacy.revoked_at is not None:
            await store.revoke_credential(db, credential_id=imported.id)
            replacement_exists = legacy is not None and any(
                active.provider == legacy.provider and active.id != legacy.id
                for active in active_legacy_by_id.values()
            )
            if replacement_exists:
                changed = True
                continue
            affected = await store.list_active_selections_for_credential_or_share(
                db,
                credential_id=imported.id,
            )
            for selection in affected:
                await store.mark_selection_invalid(
                    db,
                    selection_id=selection.id,
                    error_code="legacy_cloud_credential_revoked",
                    error_message="Synced cloud credential was revoked.",
                )
                await _bump_profile_for_selection(
                    db,
                    selection,
                    actor_user_id=actor_user_id,
                    reason="legacy_cloud_credential_revoked",
                    force_restart=True,
                )
            changed = True
    if not active_legacy_by_id:
        return profile
    existing_selections = {
        selection.agent_kind: selection
        for selection in await store.list_selections_for_profile(db, profile.id)
    }
    for legacy in active_legacy_by_id.values():
        credential = await store.find_agent_auth_credential_for_legacy_cloud_credential(
            db,
            legacy.id,
        )
        if credential is None:
            credential = await store.create_agent_auth_credential(
                db,
                owner_scope="personal",
                owner_user_id=actor_user_id,
                organization_id=None,
                created_by_user_id=actor_user_id,
                agent_kind=legacy.provider,
                credential_kind="synced_path",
                display_name=f"Synced {legacy.provider} auth",
                redacted_summary_json=json.dumps(
                    {
                        "source": "cloud_credential",
                        "authMode": legacy.auth_mode,
                    },
                    sort_keys=True,
                ),
                status="ready",
                legacy_cloud_credential_id=legacy.id,
            )
            await store.record_audit_event(
                db,
                action="credential.import_legacy",
                actor_user_id=actor_user_id,
                owner_scope="personal",
                owner_user_id=actor_user_id,
                organization_id=None,
                credential_id=credential.id,
                sandbox_profile_id=profile.id,
                metadata_json=json.dumps(
                    {"legacyCloudCredentialId": str(legacy.id)}, sort_keys=True
                ),
            )
            imported_credential_ids.add(credential.id)
        elif (
            credential.revoked_at is None
            and legacy.updated_at is not None
            and legacy.updated_at > credential.updated_at
        ):
            credential = (
                await store.update_credential_status(
                    db,
                    credential_id=credential.id,
                    status="ready",
                    redacted_summary_json=json.dumps(
                        {
                            "source": "cloud_credential",
                            "authMode": legacy.auth_mode,
                        },
                        sort_keys=True,
                    ),
                )
                or credential
            )
            imported_credential_ids.add(credential.id)
            changed = True
        if credential.revoked_at is not None:
            continue
        selection = existing_selections.get(legacy.provider)
        should_select = False
        if selection is None:
            should_select = True
        elif selection.credential_id in imported_credential_ids:
            should_select = (
                selection.status != "active"
                or selection.credential_id != credential.id
                or selection.selected_revision != credential.revision
            )
        if should_select:
            await store.upsert_selection(
                db,
                sandbox_profile_id=profile.id,
                owner_scope="personal",
                agent_kind=legacy.provider,
                credential_id=credential.id,
                credential_share_id=None,
                materialization_mode="synced_files",
                selected_revision=credential.revision,
                status="active",
                last_error_code=None,
                last_error_message=None,
            )
            changed = True
    if not changed:
        return profile
    updated = await store.bump_sandbox_profile_agent_auth_revision(
        db,
        sandbox_profile_id=profile.id,
        reason="legacy_cloud_credential_import",
        actor_user_id=actor_user_id,
        force_restart=False,
    )
    if updated is not None:
        await _mark_target_pending_and_queue_refresh(
            db,
            profile=updated,
            actor_user_id=actor_user_id,
            reason="legacy_cloud_credential_import",
            force_restart=False,
        )
    return updated or profile


async def _reconcile_managed_budget_subject(
    db: AsyncSession,
    *,
    budget: AgentGatewayBudgetSubjectRecord,
) -> AgentGatewayBudgetSubjectRecord:
    managed_deployments = tuple(
        deployment
        for agent_kind in _MANAGED_CREDIT_AGENT_KINDS_V1
        for deployment in _gateway_deployments_for_credential(
            agent_kind=agent_kind,
            provider_kind="proliferate_bedrock_pool",
        )
    )
    sync_status = "failed"
    status = "invalid"
    fingerprint = None
    error_code = "managed_credit_models_not_configured"
    error_message = "No managed-credit model deployments are configured."
    team_id = budget.litellm_team_id
    if managed_deployments:
        try:
            client = LiteLLMAdminClient()
            team = await client.ensure_team(
                team_alias=f"org-{budget.organization_id}-managed-credits",
                team_id=budget.litellm_team_id,
                max_budget=budget.included_budget_usd,
                budget_duration=budget.budget_duration,
            )
            team_id = team.team_id
            for deployment in managed_deployments:
                # See ensure_managed_credits_for_organization for why managed
                # credits intentionally use global LiteLLM deployments.
                await client.create_model_deployment(
                    public_model_name=deployment.public_model_name,
                    provider_model=deployment.provider_model,
                    litellm_params=_provider_litellm_params(
                        provider_kind="proliferate_bedrock_pool",
                        provider_payload={},
                        deployment=deployment,
                    ),
                    metadata={
                        "organizationId": str(budget.organization_id),
                        "budgetKind": budget.budget_kind,
                    },
                )
            sync_status = "synced"
            status = "exhausted" if budget.status == "exhausted" else "ready"
            fingerprint = _deployment_fingerprint(
                policy_kind="proliferate_managed",
                litellm_team_id=team_id,
                budget_subject_id=str(budget.id),
                provider_kind="proliferate_bedrock_pool",
                deployments=managed_deployments,
            )
            error_code = None
            error_message = None
        except LiteLLMIntegrationError as exc:
            error_code = "litellm_provisioning_failed"
            error_message = _safe_error_message(str(exc), {})
    return await store.ensure_managed_budget_subject(
        db,
        organization_id=budget.organization_id,
        included_budget_usd=budget.included_budget_usd,
        litellm_team_id=team_id,
        litellm_sync_status=sync_status,
        litellm_sync_fingerprint=fingerprint,
        status=status,
        last_error_code=error_code,
        last_error_message=error_message,
    )


async def _reconcile_gateway_policy(
    db: AsyncSession,
    *,
    policy: AgentGatewayPolicyRecord,
) -> AgentGatewayPolicyRecord:
    credential = await store.get_credential(db, policy.credential_id)
    if credential is None or credential.revoked_at is not None or credential.status == "revoked":
        return await store.ensure_gateway_policy(
            db,
            credential_id=policy.credential_id,
            policy_kind=policy.policy_kind,
            owner_scope=policy.owner_scope,
            owner_user_id=policy.owner_user_id,
            organization_id=policy.organization_id,
            budget_subject_id=policy.budget_subject_id,
            litellm_team_id=policy.litellm_team_id,
            litellm_virtual_key_id=policy.litellm_virtual_key_id,
            litellm_virtual_key_ciphertext=policy.litellm_virtual_key_ciphertext,
            litellm_virtual_key_ciphertext_key_id=policy.litellm_virtual_key_ciphertext_key_id,
            litellm_sync_status="failed",
            litellm_sync_fingerprint=policy.litellm_sync_fingerprint,
            status="invalid",
            last_error_code="credential_not_ready",
            last_error_message="Agent auth credential is not available for reconciliation.",
        )
    if policy.policy_kind == "proliferate_managed":
        if policy.budget_subject_id is None:
            return await _mark_policy_reconciliation_failed(
                db,
                policy=policy,
                error_code="managed_budget_missing",
                error_message="Managed gateway policy is missing a budget subject.",
            )
        budget = await store.get_budget_subject(db, policy.budget_subject_id)
        if budget is None or budget.status == "revoked":
            return await _mark_policy_reconciliation_failed(
                db,
                policy=policy,
                error_code="managed_budget_missing",
                error_message="Managed budget subject is not available.",
            )
        if budget.litellm_sync_status != "synced" or budget.status not in {"ready", "exhausted"}:
            budget = await _reconcile_managed_budget_subject(db, budget=budget)
        policy_status = (
            "ready"
            if budget.litellm_sync_status == "synced" and budget.status in {"ready", "exhausted"}
            else "invalid"
        )
        policy_sync_status = "synced" if policy_status == "ready" else "failed"
        return await _ensure_managed_policy(
            db,
            credential=credential,
            budget=budget,
            sync_status=policy_sync_status,
            status=policy_status,
            fingerprint=budget.litellm_sync_fingerprint,
            error_code=None if policy_status == "ready" else budget.last_error_code,
            error_message=None if policy_status == "ready" else budget.last_error_message,
            existing_policy=policy,
        )

    byok_verdict = await _gateway_byok_launch_verdict(db, policy)
    if byok_verdict is not None:
        reconciled = await _mark_policy_reconciliation_failed(
            db,
            policy=policy,
            error_code=byok_verdict[0],
            error_message=byok_verdict[1],
        )
        await store.update_credential_status(
            db,
            credential_id=credential.id,
            status="invalid",
        )
        return reconciled

    provider_credential = await store.get_provider_credential_for_policy(db, policy.id)
    if provider_credential is None:
        return await _mark_policy_reconciliation_failed(
            db,
            policy=policy,
            error_code="provider_credential_missing",
            error_message="Gateway provider credential is not configured.",
        )
    if provider_credential.validation_status == "invalid":
        return await _mark_policy_reconciliation_failed(
            db,
            policy=policy,
            error_code=provider_credential.validation_error_code or "provider_credential_invalid",
            error_message=(
                provider_credential.validation_error_message
                or "Gateway provider credential is invalid."
            ),
        )
    if provider_credential.validation_status != "valid":
        return await _mark_policy_reconciliation_failed(
            db,
            policy=policy,
            error_code=(
                provider_credential.validation_error_code or "provider_live_validation_required"
            ),
            error_message=(
                provider_credential.validation_error_message
                or "Provider credentials require live validation before use."
            ),
        )
    payload = decrypt_json(provider_credential.payload_ciphertext)
    provider_payload = {str(key): str(value) for key, value in payload.items()}
    reconciled_policy, sync_status, status, _error_code, _error_message = await _provision_policy(
        db,
        credential=credential,
        policy_kind=policy.policy_kind,
        owner_scope=policy.owner_scope,
        owner_user_id=policy.owner_user_id,
        organization_id=policy.organization_id,
        budget_subject_id=policy.budget_subject_id,
        provider_kind=provider_credential.provider_kind,
        provider_payload=provider_payload,
        model_deployments=_gateway_deployments_for_credential(
            agent_kind=credential.agent_kind,
            provider_kind=provider_credential.provider_kind,
        ),
        existing_policy=policy,
    )
    await store.update_credential_status(
        db,
        credential_id=credential.id,
        status="ready" if sync_status == "synced" and status == "ready" else "invalid",
    )
    return reconciled_policy


async def _mark_policy_reconciliation_failed(
    db: AsyncSession,
    *,
    policy: AgentGatewayPolicyRecord,
    error_code: str,
    error_message: str,
) -> AgentGatewayPolicyRecord:
    return await store.ensure_gateway_policy(
        db,
        credential_id=policy.credential_id,
        policy_kind=policy.policy_kind,
        owner_scope=policy.owner_scope,
        owner_user_id=policy.owner_user_id,
        organization_id=policy.organization_id,
        budget_subject_id=policy.budget_subject_id,
        litellm_team_id=policy.litellm_team_id,
        litellm_virtual_key_id=policy.litellm_virtual_key_id,
        litellm_virtual_key_ciphertext=policy.litellm_virtual_key_ciphertext,
        litellm_virtual_key_ciphertext_key_id=policy.litellm_virtual_key_ciphertext_key_id,
        litellm_sync_status="failed",
        litellm_sync_fingerprint=policy.litellm_sync_fingerprint,
        status="invalid",
        last_error_code=error_code,
        last_error_message=error_message,
    )


async def _ensure_managed_policy(
    db: AsyncSession,
    *,
    credential: AgentAuthCredentialRecord,
    budget: AgentGatewayBudgetSubjectRecord,
    sync_status: str,
    status: str,
    fingerprint: str | None,
    error_code: str | None,
    error_message: str | None,
    existing_policy: AgentGatewayPolicyRecord | None = None,
) -> AgentGatewayPolicyRecord:
    virtual_key_id = existing_policy.litellm_virtual_key_id if existing_policy else None
    virtual_key_ciphertext = (
        existing_policy.litellm_virtual_key_ciphertext if existing_policy else None
    )
    virtual_key_ciphertext_key_id = (
        existing_policy.litellm_virtual_key_ciphertext_key_id if existing_policy else None
    )
    if existing_policy is not None and existing_policy.litellm_team_id != budget.litellm_team_id:
        virtual_key_id = None
        virtual_key_ciphertext = None
        virtual_key_ciphertext_key_id = None
    if sync_status == "synced" and budget.litellm_team_id:
        try:
            if virtual_key_ciphertext is None:
                key = await LiteLLMAdminClient().generate_key(
                    team_id=budget.litellm_team_id,
                    key_alias=f"credential-{credential.id}",
                )
                virtual_key_id = key.key_id
                virtual_key_ciphertext = encrypt_text(key.key)
                virtual_key_ciphertext_key_id = AGENT_GATEWAY_CIPHERTEXT_KEY_ID
        except LiteLLMIntegrationError as exc:
            sync_status = "failed"
            status = "invalid"
            error_code = "litellm_key_provisioning_failed"
            error_message = _safe_error_message(str(exc), {})
    return await store.ensure_gateway_policy(
        db,
        credential_id=credential.id,
        policy_kind="proliferate_managed",
        owner_scope="organization",
        owner_user_id=None,
        organization_id=credential.organization_id,
        budget_subject_id=budget.id,
        litellm_team_id=budget.litellm_team_id,
        litellm_virtual_key_id=virtual_key_id,
        litellm_virtual_key_ciphertext=virtual_key_ciphertext,
        litellm_virtual_key_ciphertext_key_id=virtual_key_ciphertext_key_id,
        litellm_sync_status=sync_status,
        litellm_sync_fingerprint=fingerprint,
        status=status,
        last_error_code=error_code,
        last_error_message=error_message,
    )


async def _provision_policy(
    db: AsyncSession,
    *,
    credential: AgentAuthCredentialRecord,
    policy_kind: str,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    budget_subject_id: UUID | None,
    provider_kind: str,
    provider_payload: dict[str, str],
    model_deployments: Sequence[LiteLLMModelDeploymentRequest],
    existing_policy: AgentGatewayPolicyRecord | None = None,
) -> tuple[AgentGatewayPolicyRecord, str, str, str | None, str | None]:
    sync_status = "failed"
    status = "invalid"
    litellm_team_id = existing_policy.litellm_team_id if existing_policy else None
    virtual_key_id = existing_policy.litellm_virtual_key_id if existing_policy else None
    virtual_key_ciphertext = (
        existing_policy.litellm_virtual_key_ciphertext if existing_policy else None
    )
    virtual_key_ciphertext_key_id = (
        existing_policy.litellm_virtual_key_ciphertext_key_id if existing_policy else None
    )
    if litellm_team_id is None:
        virtual_key_id = None
        virtual_key_ciphertext = None
        virtual_key_ciphertext_key_id = None
    error_code = "litellm_not_configured"
    error_message = "LiteLLM provisioning is not configured."
    if not model_deployments:
        error_code = "model_deployments_not_configured"
        error_message = "No gateway model deployments are configured for this credential."
    fingerprint = _deployment_fingerprint(
        policy_kind=policy_kind,
        litellm_team_id=None,
        budget_subject_id=str(budget_subject_id) if budget_subject_id else None,
        provider_kind=provider_kind,
        deployments=model_deployments,
    )
    if (
        model_deployments
        and settings.agent_gateway_enabled
        and settings.agent_gateway_litellm_master_key
    ):
        try:
            client = LiteLLMAdminClient()
            team = await client.ensure_team(
                team_alias=f"credential-{credential.id}",
                team_id=litellm_team_id,
            )
            litellm_team_id = team.team_id
            if virtual_key_ciphertext is None:
                key = await client.generate_key(
                    team_id=team.team_id,
                    key_alias=f"credential-{credential.id}",
                )
                virtual_key_id = key.key_id
                virtual_key_ciphertext = encrypt_text(key.key)
                virtual_key_ciphertext_key_id = AGENT_GATEWAY_CIPHERTEXT_KEY_ID
            for deployment in model_deployments:
                await client.create_model_deployment(
                    public_model_name=deployment.public_model_name,
                    provider_model=deployment.provider_model,
                    team_id=team.team_id,
                    litellm_params=_provider_litellm_params(
                        provider_kind=provider_kind,
                        provider_payload=provider_payload,
                        deployment=deployment,
                    ),
                    metadata={
                        "credentialId": str(credential.id),
                        "agentKind": credential.agent_kind,
                    },
                )
            sync_status = "synced"
            status = "ready"
            fingerprint = _deployment_fingerprint(
                policy_kind=policy_kind,
                litellm_team_id=litellm_team_id,
                budget_subject_id=str(budget_subject_id) if budget_subject_id else None,
                provider_kind=provider_kind,
                deployments=model_deployments,
            )
            error_code = None
            error_message = None
        except LiteLLMIntegrationError as exc:
            error_code = "litellm_provisioning_failed"
            error_message = _safe_error_message(str(exc), provider_payload)

    policy = await store.ensure_gateway_policy(
        db,
        credential_id=credential.id,
        policy_kind=policy_kind,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        budget_subject_id=budget_subject_id,
        litellm_team_id=litellm_team_id,
        litellm_virtual_key_id=virtual_key_id,
        litellm_virtual_key_ciphertext=virtual_key_ciphertext,
        litellm_virtual_key_ciphertext_key_id=virtual_key_ciphertext_key_id,
        litellm_sync_status=sync_status,
        litellm_sync_fingerprint=fingerprint,
        status=status,
        last_error_code=error_code,
        last_error_message=error_message,
    )
    return policy, sync_status, status, error_code, error_message


def _provider_litellm_params(
    *,
    provider_kind: str,
    provider_payload: dict[str, str],
    deployment: LiteLLMModelDeploymentRequest,
) -> dict[str, object]:
    params: dict[str, object] = {}
    if provider_kind == "anthropic_api_key":
        params["api_key"] = provider_payload["apiKey"]
        params.setdefault("custom_llm_provider", "anthropic")
    elif provider_kind == "openai_api_key":
        params["api_key"] = provider_payload["apiKey"]
        params.setdefault("custom_llm_provider", "openai")
    elif provider_kind == "openai_compatible":
        params["api_key"] = provider_payload["apiKey"]
        params["api_base"] = provider_payload["baseUrl"]
        params.setdefault("custom_llm_provider", "openai")
    elif provider_kind == "bedrock_assume_role":
        params["aws_role_name"] = provider_payload["roleArn"]
        params["aws_external_id"] = provider_payload["externalId"]
        params["aws_region_name"] = provider_payload["region"]
        params.setdefault("custom_llm_provider", "bedrock")
    elif provider_kind == "proliferate_bedrock_pool":
        params.setdefault("custom_llm_provider", "bedrock")
    return params


def _gateway_deployments_for_credential(
    *,
    agent_kind: str,
    provider_kind: str,
) -> tuple[LiteLLMModelDeploymentRequest, ...]:
    if agent_kind == "claude":
        if provider_kind in {"bedrock_assume_role", "proliferate_bedrock_pool"}:
            return (
                LiteLLMModelDeploymentRequest(
                    publicModelName="us.anthropic.claude-sonnet-4-6",
                    providerModel="us.anthropic.claude-sonnet-4-6",
                ),
            )
        if provider_kind == "anthropic_api_key":
            return (
                LiteLLMModelDeploymentRequest(
                    publicModelName="us.anthropic.claude-sonnet-4-6",
                    providerModel="claude-sonnet-4-6",
                ),
            )
    if agent_kind == "codex" and provider_kind in {"openai_api_key", "openai_compatible"}:
        return (
            LiteLLMModelDeploymentRequest(
                publicModelName="gpt-5.5",
                providerModel="gpt-5.5",
            ),
        )
    if agent_kind == "opencode" and provider_kind in {"openai_api_key", "openai_compatible"}:
        return (
            LiteLLMModelDeploymentRequest(
                publicModelName="opencode/big-pickle",
                providerModel="gpt-5.5",
            ),
        )
    return ()


async def _require_credential_ready_for_selection(
    db: AsyncSession,
    credential: AgentAuthCredentialRecord,
) -> None:
    if credential.status != "ready" or credential.revoked_at is not None:
        raise AgentAuthError(
            "Credential is not ready.",
            code="credential_not_ready",
            status_code=409,
        )
    if credential.credential_kind != "managed_gateway":
        return
    policy = await store.get_gateway_policy_for_credential(db, credential.id)
    if policy is None or policy.status != "ready" or policy.litellm_sync_status != "synced":
        raise AgentAuthError(
            "Gateway policy is not ready.",
            code="gateway_policy_not_ready",
            status_code=409,
        )
    byok_verdict = await _gateway_byok_launch_verdict(db, policy)
    if byok_verdict is not None:
        raise AgentAuthError(byok_verdict[1], code=byok_verdict[0], status_code=403)


def _validate_policy_owner_scope(policy_kind: str, owner_scope: str) -> None:
    if policy_kind == "personal_byok" and owner_scope != "personal":
        raise AgentAuthError(
            "personal_byok can only be used for personal credentials.",
            code="policy_owner_scope_mismatch",
            status_code=400,
        )
    if policy_kind == "org_byok" and owner_scope != "organization":
        raise AgentAuthError(
            "org_byok can only be used for organization credentials.",
            code="policy_owner_scope_mismatch",
            status_code=400,
        )


def _require_gateway_byok_enabled(provider_kind: str) -> None:
    if not _gateway_byok_provider_enabled(provider_kind):
        raise AgentAuthError(
            "Gateway BYOK provider credentials are disabled.",
            code="gateway_byok_disabled",
            status_code=403,
        )


async def _gateway_byok_launch_verdict(
    db: AsyncSession,
    policy: AgentGatewayPolicyRecord,
) -> tuple[str, str] | None:
    if policy.policy_kind == "proliferate_managed":
        return None
    if policy.policy_kind not in {"org_byok", "personal_byok"}:
        return (
            "unsupported_gateway_policy_kind",
            "Gateway policy kind is not supported.",
        )
    if not settings.agent_gateway_byok_enabled:
        return (
            "gateway_byok_disabled",
            "Gateway BYOK provider credentials are disabled.",
        )
    provider_credential = await store.get_provider_credential_for_policy(db, policy.id)
    if provider_credential is None:
        return (
            "provider_credential_missing",
            "Gateway provider credential is not configured.",
        )
    if not _gateway_byok_provider_enabled(provider_credential.provider_kind):
        return (
            "gateway_byok_disabled",
            "Gateway BYOK provider credentials are disabled.",
        )
    return None


def _gateway_byok_provider_enabled(provider_kind: str) -> bool:
    if not settings.agent_gateway_byok_enabled:
        return False
    if provider_kind == "anthropic_api_key":
        return settings.agent_gateway_anthropic_byok_enabled
    if provider_kind == "openai_api_key":
        return settings.agent_gateway_openai_byok_enabled
    if provider_kind == "bedrock_assume_role":
        return settings.agent_gateway_bedrock_byok_enabled
    if provider_kind == "openai_compatible":
        return settings.agent_gateway_openai_compatible_byok_enabled
    return False


def _safe_error_message(
    message: str | None,
    secret_payload: dict[str, str],
) -> str | None:
    if message is None:
        return None
    safe = message
    for value in secret_payload.values():
        if value:
            safe = safe.replace(value, "[REDACTED]")
    return safe[:1000]


@dataclass(frozen=True)
class _ProviderValidation:
    status: str
    redacted_summary: dict[str, object]
    error_code: str | None
    error_message: str | None


def _validate_provider_payload(
    provider_kind: str,
    payload: dict[str, str],
) -> _ProviderValidation:
    try:
        if provider_kind in {"anthropic_api_key", "openai_api_key"}:
            api_key = payload.get("apiKey", "").strip()
            if not api_key:
                raise AgentAuthError(
                    "apiKey is required.", code="missing_api_key", status_code=400
                )
            return _ProviderValidation(
                status="unvalidated",
                redacted_summary={
                    "providerKind": provider_kind,
                    "apiKey": _redact_secret(api_key),
                },
                error_code="provider_live_validation_deferred",
                error_message="Provider credentials require live validation before use.",
            )
        if provider_kind == "bedrock_assume_role":
            result = validate_bedrock_assume_role_payload(
                role_arn=payload.get("roleArn", ""),
                external_id=payload.get("externalId", ""),
                region=payload.get("region", ""),
            )
            return _ProviderValidation(
                status="unvalidated",
                redacted_summary={
                    "providerKind": provider_kind,
                    "roleArn": result.role_arn,
                    "region": result.region,
                    "accountId": result.account_id,
                },
                error_code="provider_live_validation_deferred",
                error_message="Provider credentials require live validation before use.",
            )
        if provider_kind == "openai_compatible":
            base_url = _validate_openai_compatible_url(payload.get("baseUrl", ""))
            api_key = payload.get("apiKey", "").strip()
            if not api_key:
                raise AgentAuthError(
                    "apiKey is required.", code="missing_api_key", status_code=400
                )
            return _ProviderValidation(
                status="unvalidated",
                redacted_summary={
                    "providerKind": provider_kind,
                    "baseUrl": base_url,
                    "apiKey": _redact_secret(api_key),
                },
                error_code="provider_live_validation_deferred",
                error_message="Provider credentials require live validation before use.",
            )
    except AwsIntegrationError as exc:
        return _ProviderValidation(
            status="invalid",
            redacted_summary={"providerKind": provider_kind},
            error_code=exc.code,
            error_message=str(exc),
        )
    raise AgentAuthError(
        "Unsupported provider kind.", code="unsupported_provider_kind", status_code=400
    )


def _validate_openai_compatible_url(raw_url: str) -> str:
    parsed = urlparse(raw_url.strip())
    if parsed.scheme != "https" or not parsed.netloc:
        raise AgentAuthError(
            "OpenAI-compatible base URL must be an HTTPS URL.",
            code="invalid_base_url",
            status_code=400,
        )
    host = parsed.hostname
    if host is None:
        raise AgentAuthError(
            "OpenAI-compatible base URL host is required.",
            code="invalid_base_url",
            status_code=400,
        )
    if host in {"localhost", "127.0.0.1", "::1"}:
        raise AgentAuthError(
            "OpenAI-compatible base URL cannot point to localhost.",
            code="invalid_base_url",
            status_code=400,
        )
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, None)}
    except socket.gaierror as exc:
        raise AgentAuthError(
            "OpenAI-compatible base URL host could not be resolved.",
            code="invalid_base_url",
            status_code=400,
        ) from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast:
            raise AgentAuthError(
                "OpenAI-compatible base URL cannot resolve to a private network.",
                code="invalid_base_url",
                status_code=400,
            )
    return raw_url.strip().rstrip("/")


def _deployment_fingerprint(
    *,
    policy_kind: str,
    litellm_team_id: str | None,
    budget_subject_id: str | None,
    provider_kind: str | None,
    deployments: Sequence[LiteLLMModelDeploymentRequest],
) -> str:
    return fingerprint_litellm_policy_state(
        policy_kind=policy_kind,
        litellm_team_id=litellm_team_id,
        budget_subject_id=budget_subject_id,
        provider_kind=provider_kind,
        model_deployments=[
            LiteLLMModelDeploymentPlan(
                public_model_name=item.public_model_name,
                provider_model=item.provider_model,
                litellm_params={},
            )
            for item in deployments
        ],
    )


async def _require_profile_access(
    db: AsyncSession,
    actor_user_id: UUID,
    sandbox_profile_id: UUID,
    *,
    admin: bool,
) -> SandboxProfileRecord:
    profile = await store.get_sandbox_profile(db, sandbox_profile_id)
    if profile is None:
        raise AgentAuthError(
            "Sandbox profile not found.", code="sandbox_profile_not_found", status_code=404
        )
    if profile.owner_scope == "personal":
        if profile.owner_user_id != actor_user_id:
            raise AgentAuthError(
                "Sandbox profile not found.", code="sandbox_profile_not_found", status_code=404
            )
        return profile
    if profile.organization_id is None:
        raise AgentAuthError("Sandbox profile is invalid.", code="invalid_sandbox_profile")
    if admin:
        await _require_organization_admin(db, actor_user_id, profile.organization_id)
    else:
        await _require_organization_member(db, actor_user_id, profile.organization_id)
    return profile


async def _require_can_manage_credential(
    db: AsyncSession,
    actor_user_id: UUID,
    credential: AgentAuthCredentialRecord,
) -> None:
    if credential.owner_scope == "personal":
        if credential.owner_user_id != actor_user_id:
            raise AgentAuthError(
                "Credential not found.", code="credential_not_found", status_code=404
            )
        return
    if credential.owner_scope == "organization" and credential.organization_id is not None:
        await _require_organization_admin(db, actor_user_id, credential.organization_id)
        return
    raise AgentAuthError(
        "Credential cannot be modified.", code="credential_modify_forbidden", status_code=403
    )


async def _require_organization_member(
    db: AsyncSession,
    actor_user_id: UUID,
    organization_id: UUID,
) -> None:
    membership = await organization_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
    )
    if membership is None:
        raise AgentAuthError(
            "Organization not found.", code="organization_not_found", status_code=404
        )


async def _require_organization_admin(
    db: AsyncSession,
    actor_user_id: UUID,
    organization_id: UUID,
) -> None:
    membership = await organization_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
    )
    if membership is None:
        raise AgentAuthError(
            "Organization not found.", code="organization_not_found", status_code=404
        )
    if membership.role not in _ORG_ADMIN_ROLES:
        raise AgentAuthError(
            "You do not have permission to manage this organization.",
            code="organization_permission_denied",
            status_code=403,
        )


async def _bump_profile_for_selection(
    db: AsyncSession,
    selection: SandboxAgentAuthSelectionRecord,
    *,
    actor_user_id: UUID,
    reason: str,
    force_restart: bool,
) -> None:
    updated_profile = await store.bump_sandbox_profile_agent_auth_revision(
        db,
        sandbox_profile_id=selection.sandbox_profile_id,
        reason=reason,
        actor_user_id=actor_user_id,
        force_restart=force_restart,
    )
    if updated_profile is not None:
        await _mark_target_pending_and_queue_refresh(
            db,
            profile=updated_profile,
            actor_user_id=actor_user_id,
            reason=reason,
            force_restart=force_restart,
        )
    await store.revoke_runtime_grants_for_selection(db, selection_id=selection.id)


async def _mark_target_pending_and_queue_refresh(
    db: AsyncSession,
    *,
    profile: SandboxProfileRecord,
    actor_user_id: UUID | None,
    reason: str,
    force_restart: bool,
) -> None:
    if profile.managed_target_id is None:
        return
    command = await _queue_agent_auth_refresh_command(
        db,
        profile=profile,
        target_id=profile.managed_target_id,
        actor_user_id=actor_user_id,
        reason=reason,
        force_restart=force_restart,
    )
    await store.upsert_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=profile.managed_target_id,
        desired_revision=profile.agent_auth_revision,
        applied_revision=None,
        status="pending",
        force_restart_required=force_restart,
        last_command_id=command.id,
        last_worker_id=None,
        last_error_code=None,
        last_error_message=None,
    )


async def _ensure_profile_target_refresh_if_needed(
    db: AsyncSession,
    *,
    profile: SandboxProfileRecord,
    actor_user_id: UUID | None,
    reason: str,
) -> None:
    if profile.managed_target_id is None:
        return
    if profile.agent_auth_revision == 0:
        selections = await store.list_selections_for_profile(db, profile.id)
        if not selections:
            return
    state = await store.get_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=profile.managed_target_id,
    )
    if (
        state is not None
        and state.desired_revision == profile.agent_auth_revision
        and state.last_command_id is not None
    ):
        return
    await _mark_target_pending_and_queue_refresh(
        db,
        profile=profile,
        actor_user_id=actor_user_id,
        reason=reason,
        force_restart=False,
    )


async def _queue_agent_auth_refresh_command(
    db: AsyncSession,
    *,
    profile: SandboxProfileRecord,
    target_id: UUID,
    actor_user_id: UUID | None,
    reason: str,
    force_restart: bool,
) -> commands_store.CloudCommandSnapshot:
    idempotency_scope = f"target:{target_id}:agent-auth-config:{profile.id}"
    idempotency_key = f"agent-auth-config:{target_id}:{profile.id}:{profile.agent_auth_revision}"
    existing = await commands_store.get_command_by_idempotency(
        db,
        idempotency_scope=idempotency_scope,
        idempotency_key=idempotency_key,
    )
    if existing is not None:
        await publish_command_status_after_commit(db, existing)
        return existing
    payload = {
        "sandboxProfileId": str(profile.id),
        "revision": profile.agent_auth_revision,
        "reason": reason,
        "forceRestart": force_restart,
    }
    actor_kind = (
        CloudCommandActorKind.user.value
        if actor_user_id is not None
        else CloudCommandActorKind.system.value
    )
    try:
        async with db.begin_nested():
            command = await commands_store.create_command(
                db,
                idempotency_scope=idempotency_scope,
                idempotency_key=idempotency_key,
                target_id=target_id,
                organization_id=profile.organization_id,
                actor_user_id=actor_user_id,
                actor_kind=actor_kind,
                source=CloudCommandSource.api.value,
                workspace_id=None,
                session_id=None,
                kind=CloudCommandKind.refresh_agent_auth_config.value,
                payload_json=compact_command_json(payload) or "{}",
                observed_event_seq=None,
                preconditions_json=None,
                authorization_context_json=compact_command_json(
                    {
                        "actorUserId": str(actor_user_id) if actor_user_id else None,
                        "sandboxProfileId": str(profile.id),
                        "targetOwnerScope": profile.owner_scope,
                        "targetOrganizationId": (
                            str(profile.organization_id) if profile.organization_id else None
                        ),
                    }
                ),
            )
    except IntegrityError:
        duplicate = await commands_store.get_command_by_idempotency(
            db,
            idempotency_scope=idempotency_scope,
            idempotency_key=idempotency_key,
        )
        if duplicate is None:
            raise
        command = duplicate
    await publish_command_status_after_commit(db, command)
    return command


def _hash_token(raw_token: str) -> str:
    return hmac.new(
        settings.cloud_secret_key.encode("utf-8"),
        f"{AGENT_GATEWAY_RUNTIME_GRANT_TOKEN_DOMAIN}:{raw_token}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _clean_display_name(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise AgentAuthError(
            "displayName is required.", code="missing_display_name", status_code=400
        )
    if len(cleaned) > 255:
        raise AgentAuthError(
            "displayName is too long.", code="display_name_too_long", status_code=400
        )
    return cleaned


def _budget_amount(value: str) -> str:
    try:
        amount = Decimal(value)
    except InvalidOperation as exc:
        raise AgentAuthError(
            "Included budget must be a decimal string.", code="invalid_budget", status_code=400
        ) from exc
    if amount < 0:
        raise AgentAuthError(
            "Included budget must be non-negative.", code="invalid_budget", status_code=400
        )
    return format(amount, "f")


def _managed_credit_entitlement_budget() -> str:
    budget = _budget_amount(settings.agent_gateway_default_managed_budget_usd)
    if Decimal(budget) <= 0:
        raise AgentAuthError(
            "Managed credits are not enabled for this organization.",
            code="managed_credits_not_entitled",
            status_code=403,
        )
    return budget


def _redact_secret(value: str) -> str:
    if len(value) <= 8:
        return "[REDACTED]"
    return f"{value[:4]}...{value[-4:]}"
