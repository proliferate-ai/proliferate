"""Service layer for cloud agent auth."""

from __future__ import annotations

import hashlib
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

from cryptography.fernet import InvalidToken
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import PolicyDenied
from proliferate.config import settings
from proliferate.constants.billing import BILLING_PLAN_PRO
from proliferate.constants.cloud import (
    AGENT_GATEWAY_BUDGET_DURATION_V1,
    AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
    CLAUDE_ALLOWED_AUTH_FILES,
    CODEX_ALLOWED_AUTH_FILES,
    GEMINI_ALLOWED_AUTH_FILES,
    SUPPORTED_CLOUD_CREDENTIAL_SYNC_AGENTS,
    CloudAgentKind,
    CloudCommandActorKind,
    CloudCommandKind,
    CloudCommandSource,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db import engine as db_engine
from proliferate.db.store import cloud_sandboxes
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.billing import (
    ensure_agent_gateway_free_credit_allocation,
    ensure_organization_billing_subject,
)
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialRecord,
    AgentAuthCredentialShareRecord,
    AgentGatewayBudgetSubjectRecord,
    AgentGatewayFreeCreditEntitlementRecord,
    AgentGatewayPolicyRecord,
    AgentGatewayProviderCredentialRecord,
    AgentGatewayRouterMaterializationRecord,
    SandboxAgentAuthSelectionRecord,
    SandboxProfileAgentAuthTargetStateRecord,
    SandboxProfileRecord,
)
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.integrations.aws import (
    AwsIntegrationError,
    validate_bedrock_assume_role_payload,
)
from proliferate.integrations.bifrost import (
    BifrostAdminClient,
    BifrostIntegrationError,
    bifrost_env_var,
)
from proliferate.server.billing.service import get_billing_snapshot_for_subject_in_session
from proliferate.server.cloud.agent_auth.domain.byok_policy import (
    GatewayByokVerdict,
    gateway_byok_policy_verdict,
)
from proliferate.server.cloud.agent_auth.domain.desired_state import (
    GatewayModelDeploymentPlan,
    fingerprint_gateway_policy_state,
)
from proliferate.server.cloud.agent_auth.domain.policy import (
    SelectionPlan,
    can_select_credential_for_profile,
    is_supported_agent_kind,
    selection_plan_for_credential,
)
from proliferate.server.cloud.agent_auth.domain.synced_payload import (
    normalize_synced_credential_payload,
    redacted_synced_payload_summary,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.models import (
    CreateGatewayCredentialRequest,
    EnsureFreeManagedCreditsRequest,
    EnsureManagedCreditsRequest,
    GatewayModelDeploymentRequest,
    SyncSyncedCredentialRequest,
    WorkerAgentAuthGatewayConfig,
    WorkerAgentAuthMaterializationPlan,
    WorkerAgentAuthSelectionPlan,
    WorkerAgentAuthStatusRequest,
    WorkerAgentAuthStatusResponse,
    WorkerAgentAuthSyncedFilesConfig,
)
from proliferate.server.cloud.agent_auth.protected_env import reject_unallowed_protected_env
from proliferate.server.cloud.commands.domain.rules import compact_command_json
from proliferate.server.cloud.live.service import publish_command_status_after_commit
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.server.cloud.worker.slot_guard import require_current_managed_worker_slot
from proliferate.utils.crypto import decrypt_json, decrypt_text, encrypt_json, encrypt_text
from proliferate.utils.time import utcnow

_ORG_ADMIN_ROLES = {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}
_GATEWAY_GRANT_TTL = timedelta(days=7)
_DEFAULT_MANAGED_CREDIT_AGENT_KINDS: tuple[CloudAgentKind, ...] = ("claude",)
_USER_FREE_CREDIT_SOURCE = "signup_free_credit"
_CLEANUP_SELECTION_ERROR_CODES = {
    "credential_revoked",
    "credential_share_revoked",
}
_OPENCODE_ALLOWED_AUTH_FILES: frozenset[str] = frozenset({".config/opencode/auth.json"})
_TERMINAL_AGENT_AUTH_REFRESH_COMMAND_STATUSES = frozenset(
    {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.expired.value,
        CloudCommandStatus.superseded.value,
        CloudCommandStatus.failed_delivery.value,
    }
)


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
class BifrostRuntimeVirtualKeyResult:
    virtual_key: str
    virtual_key_id: str
    expires_at_iso: str


@dataclass(frozen=True)
class FreeManagedCreditReadyAgentModel:
    agent_kind: str
    public_model_names: tuple[str, ...]
    credential_id: UUID


@dataclass(frozen=True)
class EnsureFreeManagedCreditsResult:
    status: str
    launch_enabled: bool
    primary_action: str
    ready_agent_models: tuple[FreeManagedCreditReadyAgentModel, ...]
    entitlement: AgentGatewayFreeCreditEntitlementRecord | None
    budget_subject: AgentGatewayBudgetSubjectRecord | None
    credentials: tuple[AgentAuthCredentialRecord, ...]
    policies: tuple[AgentGatewayPolicyRecord, ...]
    last_error_code: str | None
    last_error_message: str | None


@dataclass(frozen=True)
class CredentialListItem:
    credential: AgentAuthCredentialRecord
    active_share: AgentAuthCredentialShareRecord | None


@dataclass(frozen=True)
class SyncSyncedCredentialResult:
    credential: AgentAuthCredentialRecord
    selection: SandboxAgentAuthSelectionRecord
    changed: bool


@dataclass(frozen=True)
class AgentGatewayReconcilePassResult:
    budgets_checked: int
    budgets_reconciled: int
    budgets_failed: int
    policies_checked: int
    policies_reconciled: int
    policies_failed: int


@dataclass(frozen=True)
class RuntimeGrantFreshnessReconcilePassResult:
    grants_checked: int
    targets_refreshed: int
    grants_skipped: int
    grants_failed: int


async def ensure_personal_sandbox_profile(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
) -> SandboxProfileRecord:
    profile = await store.ensure_personal_sandbox_profile(
        db,
        user_id=actor_user_id,
        created_by_user_id=actor_user_id,
    )
    await _ensure_profile_target_refresh_if_needed(
        db,
        profile=profile,
        actor_user_id=actor_user_id,
        reason="sandbox_profile_target_attached",
    )
    return profile


async def ensure_organization_sandbox_profile(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
) -> SandboxProfileRecord:
    await _require_organization_admin(db, actor_user_id, organization_id)
    profile = await store.ensure_organization_sandbox_profile(
        db,
        organization_id=organization_id,
        created_by_user_id=actor_user_id,
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


async def sync_synced_credential_for_user(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    agent_kind: CloudAgentKind,
    body: SyncSyncedCredentialRequest,
) -> SyncSyncedCredentialResult:
    if agent_kind not in SUPPORTED_CLOUD_CREDENTIAL_SYNC_AGENTS:
        raise AgentAuthError(
            "Native auth sync is not supported for this agent.",
            code="unsupported_synced_agent_kind",
            status_code=400,
        )
    normalized = normalize_synced_credential_payload(
        agent_kind=agent_kind,
        auth_mode=body.auth_mode,
        env_vars=getattr(body, "env_vars", None),
        files=getattr(body, "files", None),
    )
    redacted_summary = redacted_synced_payload_summary(
        agent_kind=agent_kind,
        payload=normalized.payload,
    )
    redacted_summary_json = json.dumps(redacted_summary, sort_keys=True)
    payload_ciphertext = encrypt_json(normalized.payload)

    profile = await store.ensure_personal_sandbox_profile(
        db,
        user_id=actor_user_id,
        created_by_user_id=actor_user_id,
    )
    existing = await store.get_active_personal_synced_credential_for_update(
        db,
        user_id=actor_user_id,
        agent_kind=agent_kind,
    )
    payload_changed = True
    if existing is not None and existing.payload_ciphertext:
        try:
            existing_payload = decrypt_json(existing.payload_ciphertext)
        except (InvalidToken, ValueError):
            payload_changed = True
        else:
            payload_changed = (
                existing.status != "ready"
                or existing_payload != normalized.payload
                or existing.redacted_summary_json != redacted_summary_json
            )

    display_name = f"Synced {agent_kind} auth"
    if existing is None:
        credential = await store.create_agent_auth_credential(
            db,
            owner_scope="personal",
            owner_user_id=actor_user_id,
            organization_id=None,
            created_by_user_id=actor_user_id,
            agent_kind=agent_kind,
            credential_kind="synced_path",
            display_name=display_name,
            redacted_summary_json=redacted_summary_json,
            status="ready",
            payload_ciphertext=payload_ciphertext,
            payload_ciphertext_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
        )
    else:
        credential = await store.update_synced_credential_payload(
            db,
            credential_id=existing.id,
            display_name=display_name,
            redacted_summary_json=redacted_summary_json,
            payload_ciphertext=payload_ciphertext,
            payload_ciphertext_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
            status="ready",
            increment_revision=payload_changed,
        )
        if credential is None:
            raise AgentAuthError(
                "Credential not found.",
                code="credential_not_found",
                status_code=404,
            )

    plan = selection_plan_for_credential(
        agent_kind=agent_kind,
        credential_kind=credential.credential_kind,
    )
    if not isinstance(plan, SelectionPlan):
        raise AgentAuthError(plan.message, code=plan.code, status_code=plan.status_code)
    if plan.materialization_mode != "synced_files":
        raise AgentAuthError(
            "Synced credentials must materialize as files.",
            code="invalid_materialization_mode",
            status_code=500,
        )

    selections = {
        selection.agent_kind: selection
        for selection in await store.list_selections_for_profile(db, profile.id)
    }
    existing_selection = selections.get(agent_kind)
    selection_changed = (
        existing_selection is None
        or existing_selection.status != "active"
        or existing_selection.credential_id != credential.id
        or existing_selection.credential_share_id is not None
        or existing_selection.materialization_mode != plan.materialization_mode
        or existing_selection.selected_revision != credential.revision
    )
    selection = await store.upsert_selection(
        db,
        sandbox_profile_id=profile.id,
        owner_scope="personal",
        agent_kind=agent_kind,
        credential_id=credential.id,
        credential_share_id=None,
        materialization_mode=plan.materialization_mode,
        selected_revision=credential.revision,
        status="active",
        last_error_code=None,
        last_error_message=None,
    )

    changed = payload_changed or selection_changed
    if changed:
        updated_profile = await store.bump_sandbox_profile_agent_auth_revision(
            db,
            sandbox_profile_id=profile.id,
            reason="synced_credential_sync",
            actor_user_id=actor_user_id,
            force_restart=False,
        )
        if updated_profile is None:
            raise AgentAuthError(
                "Sandbox profile not found.",
                code="sandbox_profile_not_found",
                status_code=404,
            )
        await _mark_target_pending_and_queue_refresh(
            db,
            profile=updated_profile,
            actor_user_id=actor_user_id,
            reason="synced_credential_sync",
            force_restart=False,
        )

    await store.record_audit_event(
        db,
        action="credential.sync",
        actor_user_id=actor_user_id,
        owner_scope="personal",
        owner_user_id=actor_user_id,
        organization_id=None,
        credential_id=credential.id,
        sandbox_profile_id=profile.id,
        metadata_json=json.dumps(
            {
                "agentKind": agent_kind,
                "authMode": normalized.auth_mode,
                "changed": changed,
                "selectionChanged": selection_changed,
            },
            sort_keys=True,
        ),
    )
    return SyncSyncedCredentialResult(
        credential=credential,
        selection=selection,
        changed=changed,
    )


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

    _validate_policy_owner_scope(body.policy_kind, body.owner_scope)
    _require_gateway_byok_enabled(body.provider_kind)
    _require_gateway_byok_create_allowed(body.policy_kind)

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
    provider_credential: AgentGatewayProviderCredentialRecord | None = None
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
            litellm_sync_status="pending",
            litellm_sync_fingerprint=None,
            status="provisioning",
            last_error_code=None,
            last_error_message=None,
        )
        provider_credential = await store.upsert_provider_credential(
            db,
            policy_id=policy.id,
            provider_kind=body.provider_kind,
            payload_ciphertext=encrypt_json(dict(body.payload)),
            payload_ciphertext_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
            redacted_summary_json=json.dumps(validation.redacted_summary, sort_keys=True),
            validation_status=validation.status,
            validated_at=utcnow(),
            validation_error_code=None,
            validation_error_message=None,
        )
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
            existing_policy=policy,
        )
    if provider_credential is None:
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
    # comes from the organization's billing plan and deploy-time entitlement
    # settings.
    included_budget_usd = await _organization_managed_credit_entitlement_budget(
        db,
        organization_id,
    )
    requested_agent_kinds = _managed_credit_agent_kinds()
    managed_deployments = tuple(
        deployment
        for agent_kind in requested_agent_kinds
        for deployment in _gateway_deployments_for_credential(
            agent_kind=agent_kind,
            provider_kind="proliferate_bedrock_pool",
        )
    )
    initial_error_code = (
        "managed_credit_models_not_configured"
        if not managed_deployments
        else "bifrost_not_configured"
    )
    initial_error_message = (
        "No managed-credit model deployments are configured."
        if not managed_deployments
        else "Bifrost provisioning is not configured."
    )
    existing_budget = await store.get_managed_budget_subject(db, organization_id)
    budget = await store.ensure_managed_budget_subject(
        db,
        organization_id=organization_id,
        included_budget_usd=included_budget_usd,
        litellm_team_id=existing_budget.litellm_team_id if existing_budget else None,
        litellm_sync_status="failed",
        litellm_sync_fingerprint=(
            existing_budget.litellm_sync_fingerprint if existing_budget else None
        ),
        status="invalid",
        last_error_code=initial_error_code,
        last_error_message=initial_error_message,
    )
    budget = await _reconcile_managed_budget_subject(db, budget=budget)
    sync_status = budget.litellm_sync_status
    status = budget.status
    fingerprint = budget.litellm_sync_fingerprint
    error_code = budget.last_error_code
    error_message = budget.last_error_message

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
                "gatewaySyncStatus": sync_status,
            },
            sort_keys=True,
        ),
    )
    return EnsureManagedCreditsResult(
        budget_subject=budget,
        credentials=tuple(credentials),
        policies=tuple(policies),
    )


async def ensure_free_managed_credits_for_user(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    body: EnsureFreeManagedCreditsRequest,
) -> EnsureFreeManagedCreditsResult:
    budget_amount = _user_free_credit_entitlement_budget(require_positive=False)
    period_key = _user_free_credit_period_key()
    requested_agent_kinds = _managed_credit_agent_kinds()
    if body.agent_kind is not None:
        requested_agent_kinds = (
            (body.agent_kind,) if body.agent_kind in requested_agent_kinds else ()
        )
    existing_entitlement = await store.get_free_credit_entitlement(
        db,
        user_id=actor_user_id,
        source=_USER_FREE_CREDIT_SOURCE,
        period_key=period_key,
    )
    existing_budget = await store.get_user_managed_budget_subject(db, actor_user_id)
    if not settings.agent_gateway_enabled:
        return EnsureFreeManagedCreditsResult(
            status="gateway_disabled",
            launch_enabled=False,
            primary_action="disabled",
            ready_agent_models=(),
            entitlement=existing_entitlement,
            budget_subject=existing_budget,
            credentials=(),
            policies=(),
            last_error_code="agent_gateway_disabled",
            last_error_message="Agent Gateway is disabled.",
        )
    if not settings.agent_gateway_user_free_credit_enabled or Decimal(budget_amount) <= 0:
        return EnsureFreeManagedCreditsResult(
            status="not_entitled",
            launch_enabled=False,
            primary_action="none",
            ready_agent_models=(),
            entitlement=existing_entitlement,
            budget_subject=existing_budget,
            credentials=(),
            policies=(),
            last_error_code="free_credits_not_entitled",
            last_error_message="Free managed credits are not enabled for this user.",
        )
    if existing_entitlement is not None and existing_entitlement.status in {
        "exhausted",
        "expired",
        "revoked",
    }:
        return EnsureFreeManagedCreditsResult(
            status=existing_entitlement.status,
            launch_enabled=False,
            primary_action="none",
            ready_agent_models=(),
            entitlement=existing_entitlement,
            budget_subject=existing_budget,
            credentials=(),
            policies=(),
            last_error_code=existing_entitlement.last_error_code
            or f"free_credits_{existing_entitlement.status}",
            last_error_message=existing_entitlement.last_error_message
            or "Free managed credits are not available for this period.",
        )
    if body.agent_kind is not None and not requested_agent_kinds:
        return EnsureFreeManagedCreditsResult(
            status="agent_not_configured",
            launch_enabled=False,
            primary_action="none",
            ready_agent_models=(),
            entitlement=existing_entitlement,
            budget_subject=existing_budget,
            credentials=(),
            policies=(),
            last_error_code="managed_credit_agent_not_configured",
            last_error_message=(
                f"Proliferate free credits are not configured for {body.agent_kind}."
            ),
        )
    if not await ensure_agent_gateway_free_credit_allocation(
        db,
        user_id=actor_user_id,
        period_key=period_key,
    ):
        return EnsureFreeManagedCreditsResult(
            status="not_entitled",
            launch_enabled=False,
            primary_action="connect_github",
            ready_agent_models=(),
            entitlement=existing_entitlement,
            budget_subject=existing_budget,
            credentials=(),
            policies=(),
            last_error_code="free_credits_github_allocation_unavailable",
            last_error_message=(
                "Free managed credits require a linked GitHub account that has not "
                "already received this allocation."
            ),
        )

    profile = await store.ensure_personal_sandbox_profile(
        db,
        user_id=actor_user_id,
        created_by_user_id=actor_user_id,
    )
    entitlement = await store.ensure_free_credit_entitlement(
        db,
        user_id=actor_user_id,
        source=_USER_FREE_CREDIT_SOURCE,
        period_key=period_key,
        included_budget_usd=budget_amount,
        status="provisioning",
    )
    budget_duration = _user_free_credit_budget_duration()
    managed_deployments = tuple(
        deployment
        for agent_kind in requested_agent_kinds
        for deployment in _gateway_deployments_for_credential(
            agent_kind=agent_kind,
            provider_kind="proliferate_bedrock_pool",
        )
    )
    sync_status = "failed"
    status = "invalid"
    fingerprint = existing_budget.litellm_sync_fingerprint if existing_budget else None
    error_code = "bifrost_not_configured"
    error_message = "Bifrost provisioning is not configured."
    if existing_budget is not None and existing_budget.litellm_team_id:
        expected_fingerprint = _deployment_fingerprint(
            policy_kind="proliferate_managed",
            router_object_id=existing_budget.litellm_team_id,
            budget_subject_id=None,
            provider_kind="proliferate_bedrock_pool",
            deployments=managed_deployments,
        )
        if (
            managed_deployments
            and existing_budget.status == "ready"
            and existing_budget.litellm_sync_status == "synced"
            and existing_budget.included_budget_usd == budget_amount
            and existing_budget.budget_duration == budget_duration
            and existing_budget.entitlement_source == _USER_FREE_CREDIT_SOURCE
            and existing_budget.entitlement_period_key == period_key
            and existing_budget.litellm_sync_fingerprint == expected_fingerprint
        ):
            sync_status = "synced"
            status = "ready"
            fingerprint = expected_fingerprint
            error_code = None
            error_message = None
    if not managed_deployments:
        error_code = "managed_credit_models_not_configured"
        error_message = "No managed-credit model deployments are configured."

    budget = await store.ensure_managed_budget_subject_for_owner(
        db,
        owner_scope="personal",
        owner_user_id=actor_user_id,
        organization_id=None,
        included_budget_usd=budget_amount,
        budget_duration=budget_duration,
        entitlement_source=_USER_FREE_CREDIT_SOURCE,
        entitlement_period_key=period_key,
        litellm_team_id=existing_budget.litellm_team_id if existing_budget else None,
        litellm_sync_status=sync_status,
        litellm_sync_fingerprint=fingerprint,
        status=status,
        last_error_code=error_code,
        last_error_message=error_message,
    )
    budget = await _reconcile_managed_budget_subject(db, budget=budget)
    sync_status = budget.litellm_sync_status
    status = budget.status
    fingerprint = budget.litellm_sync_fingerprint
    error_code = budget.last_error_code
    error_message = budget.last_error_message
    entitlement = await store.ensure_free_credit_entitlement(
        db,
        user_id=actor_user_id,
        source=_USER_FREE_CREDIT_SOURCE,
        period_key=period_key,
        included_budget_usd=budget_amount,
        budget_subject_id=budget.id,
        status="active" if status == "ready" else "provisioning",
        last_error_code=error_code,
        last_error_message=error_message,
    )

    credentials: list[AgentAuthCredentialRecord] = []
    policies: list[AgentGatewayPolicyRecord] = []
    ready_models: list[FreeManagedCreditReadyAgentModel] = []
    existing_selections = {
        selection.agent_kind: selection
        for selection in await store.list_selections_for_profile(db, profile.id)
    }
    for agent_kind in requested_agent_kinds:
        deployments = _gateway_deployments_for_credential(
            agent_kind=agent_kind,
            provider_kind="proliferate_bedrock_pool",
        )
        if not deployments:
            continue
        credential = await store.get_managed_gateway_credential_for_owner(
            db,
            owner_scope="personal",
            owner_user_id=actor_user_id,
            organization_id=None,
            agent_kind=agent_kind,
        )
        redacted_summary_json = json.dumps(
            {
                "providerKind": "proliferate_bedrock_pool",
                "budgetSubjectId": str(budget.id),
                "freeCreditEntitlementId": str(entitlement.id),
            },
            sort_keys=True,
        )
        if credential is None:
            credential = await store.create_agent_auth_credential(
                db,
                owner_scope="personal",
                owner_user_id=actor_user_id,
                organization_id=None,
                created_by_user_id=actor_user_id,
                agent_kind=agent_kind,
                credential_kind="managed_gateway",
                display_name="Proliferate free credits",
                redacted_summary_json=redacted_summary_json,
                status="ready" if status == "ready" else "invalid",
            )
        else:
            desired_credential_status = "ready" if status == "ready" else "invalid"
            if (
                credential.status != desired_credential_status
                or credential.redacted_summary_json != redacted_summary_json
            ):
                credential = (
                    await store.update_credential_status(
                        db,
                        credential_id=credential.id,
                        status=desired_credential_status,
                        redacted_summary_json=redacted_summary_json,
                    )
                    or credential
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
            existing_policy=await store.get_gateway_policy_for_credential(db, credential.id),
        )
        desired_policy_credential_status = "ready" if policy.status == "ready" else "invalid"
        if credential.status != desired_policy_credential_status:
            credential = (
                await store.update_credential_status(
                    db,
                    credential_id=credential.id,
                    status=desired_policy_credential_status,
                )
                or credential
            )
        credentials.append(credential)
        policies.append(policy)
        if policy.status == "ready" and policy.litellm_sync_status == "synced":
            ready_models.append(
                FreeManagedCreditReadyAgentModel(
                    agent_kind=agent_kind,
                    public_model_names=tuple(
                        deployment.public_model_name for deployment in deployments
                    ),
                    credential_id=credential.id,
                )
            )
            if existing_selections.get(agent_kind) is None:
                await select_credential_for_profile(
                    db,
                    actor_user_id=actor_user_id,
                    sandbox_profile_id=profile.id,
                    agent_kind=agent_kind,
                    credential_id=credential.id,
                    credential_share_id=None,
                    force_restart=False,
                )

    launch_enabled = bool(ready_models)
    await store.record_audit_event(
        db,
        action="free_credits.ensure",
        actor_user_id=actor_user_id,
        owner_scope="personal",
        owner_user_id=actor_user_id,
        organization_id=None,
        sandbox_profile_id=profile.id,
        metadata_json=json.dumps(
            {
                "includedBudgetUsd": budget_amount,
                "agentKinds": list(requested_agent_kinds),
                "litellmSyncStatus": sync_status,
                "launchEnabled": launch_enabled,
            },
            sort_keys=True,
        ),
    )
    return EnsureFreeManagedCreditsResult(
        status="ready" if launch_enabled else "provisioning",
        launch_enabled=launch_enabled,
        primary_action="launch" if launch_enabled else "retry",
        ready_agent_models=tuple(ready_models),
        entitlement=entitlement,
        budget_subject=budget,
        credentials=tuple(credentials),
        policies=tuple(policies),
        last_error_code=error_code,
        last_error_message=error_message,
    )


async def sync_managed_credit_budget_for_organization(
    organization_id: UUID,
) -> AgentGatewayBudgetSubjectRecord | None:
    """Recompute and mirror an existing managed-credit budget after billing changes."""

    async with db_engine.async_session_factory() as db:
        budget = await store.get_managed_budget_subject(db, organization_id)
        if budget is None:
            return None
        reconciled = await _reconcile_managed_budget_subject(db, budget=budget)
        await db.commit()
        return reconciled


async def reconcile_agent_gateway_bifrost_router(
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
    if not settings.agent_gateway_enabled:
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

    await import_bifrost_usage_logs(db, limit=limit)

    return AgentGatewayReconcilePassResult(
        budgets_checked=len(budgets),
        budgets_reconciled=budgets_reconciled,
        budgets_failed=budgets_failed,
        policies_checked=len(policies),
        policies_reconciled=policies_reconciled,
        policies_failed=policies_failed,
    )


async def import_bifrost_usage_logs(
    db: AsyncSession,
    *,
    limit: int = 1000,
) -> int:
    if not settings.agent_gateway_enabled:
        return 0
    virtual_key_ids = await store.list_active_router_virtual_key_ids(
        db,
        router_kind="bifrost",
        limit=1000,
    )
    if not virtual_key_ids:
        return 0
    cursor = await store.get_usage_import_cursor(db, router_kind="bifrost")
    start_time = (
        cursor.last_seen_at - timedelta(minutes=5)
        if cursor is not None and cursor.last_seen_at is not None
        else utcnow() - timedelta(days=7)
    )
    client = BifrostAdminClient()
    imported = 0
    last_seen_at = cursor.last_seen_at if cursor is not None else None
    last_seen_log_id = cursor.last_seen_router_log_id if cursor is not None else None
    page_limit = min(max(limit, 1), 1000)
    offset = 0
    while True:
        result = await client.list_logs(
            start_time=start_time,
            limit=page_limit,
            offset=offset,
            order="asc",
            virtual_key_ids=virtual_key_ids,
        )
        for entry in result.logs:
            if not entry.log_id:
                continue
            if entry.timestamp is not None and (
                last_seen_at is None or entry.timestamp >= last_seen_at
            ):
                last_seen_at = entry.timestamp
                last_seen_log_id = entry.log_id
            materialization = (
                await store.get_router_materialization_by_object_id(
                    db,
                    router_kind="bifrost",
                    router_object_kind="virtual_key",
                    router_object_id=entry.virtual_key_id,
                )
                if entry.virtual_key_id
                else None
            )
            policy = (
                await store.get_gateway_policy(db, materialization.policy_id)
                if materialization is not None and materialization.policy_id is not None
                else None
            )
            budget = (
                await store.get_budget_subject(db, policy.budget_subject_id)
                if policy is not None and policy.budget_subject_id is not None
                else None
            )
            cost = entry.cost or Decimal("0")
            status = entry.status
            raw_usage: dict[str, object] = {"tokenUsage": entry.token_usage, "raw": entry.raw}
            if (
                budget is not None
                and budget.budget_kind == "proliferate_managed"
                and entry.status == "success"
                and (entry.cost is None or entry.cost <= 0)
            ):
                status = "needs_review"
                raw_usage["proliferateImportWarning"] = "missing_or_zero_managed_cost"
            usage = entry.token_usage
            inserted = await store.insert_llm_usage_event_once(
                db,
                router_kind="bifrost",
                router_log_id=entry.log_id,
                router_virtual_key_id=entry.virtual_key_id,
                router_provider_key_id=entry.selected_key_id,
                materialization=materialization,
                policy=policy,
                budget=budget,
                provider=entry.provider,
                model=entry.model,
                status=status,
                cost_usd=format(cost, "f"),
                prompt_tokens=_usage_token(usage, "prompt_tokens", "input_tokens"),
                completion_tokens=_usage_token(
                    usage,
                    "completion_tokens",
                    "output_tokens",
                ),
                total_tokens=_usage_token(usage, "total_tokens"),
                occurred_at=entry.timestamp,
                raw_usage_json=json.dumps(
                    raw_usage,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
            )
            if inserted is not None:
                imported += 1
                if budget is not None and budget.budget_kind == "proliferate_managed":
                    if status == "needs_review":
                        await _mark_managed_budget_usage_needs_review(db, budget=budget)
                    else:
                        await _exhaust_managed_budget_if_needed(db, budget=budget)
        offset += len(result.logs)
        if len(result.logs) < page_limit:
            break
        if result.total_count is not None and offset >= result.total_count:
            break
    if last_seen_at is not None or last_seen_log_id is not None:
        await store.upsert_usage_import_cursor(
            db,
            router_kind="bifrost",
            last_seen_at=last_seen_at,
            last_seen_router_log_id=last_seen_log_id,
        )
    return imported


def _usage_token(payload: dict[str, object], *keys: str) -> int | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
    return None


async def _mark_managed_budget_usage_needs_review(
    db: AsyncSession,
    *,
    budget: AgentGatewayBudgetSubjectRecord,
) -> None:
    await store.ensure_managed_budget_subject_for_owner(
        db,
        owner_scope=budget.owner_scope,
        owner_user_id=budget.owner_user_id,
        organization_id=budget.organization_id,
        included_budget_usd=budget.included_budget_usd,
        budget_duration=budget.budget_duration,
        entitlement_source=budget.entitlement_source,
        entitlement_period_key=budget.entitlement_period_key,
        litellm_team_id=budget.litellm_team_id,
        litellm_sync_status=budget.litellm_sync_status,
        litellm_sync_fingerprint=budget.litellm_sync_fingerprint,
        status="invalid",
        last_error_code="managed_usage_cost_missing",
        last_error_message=(
            "Bifrost returned a successful managed-credit request without a positive cost."
        ),
    )
    await _disable_bifrost_virtual_keys_for_budget(db, budget=budget)


async def _exhaust_managed_budget_if_needed(
    db: AsyncSession,
    *,
    budget: AgentGatewayBudgetSubjectRecord,
) -> None:
    used = await store.sum_llm_usage_cost_for_budget_subject(
        db,
        budget_subject_id=budget.id,
    )
    if used < Decimal(budget.included_budget_usd):
        return
    await store.ensure_managed_budget_subject_for_owner(
        db,
        owner_scope=budget.owner_scope,
        owner_user_id=budget.owner_user_id,
        organization_id=budget.organization_id,
        included_budget_usd=budget.included_budget_usd,
        budget_duration=budget.budget_duration,
        entitlement_source=budget.entitlement_source,
        entitlement_period_key=budget.entitlement_period_key,
        litellm_team_id=budget.litellm_team_id,
        litellm_sync_status=budget.litellm_sync_status,
        litellm_sync_fingerprint=budget.litellm_sync_fingerprint,
        status="exhausted",
        last_error_code="managed_credits_exhausted",
        last_error_message="Managed credits are exhausted.",
    )
    await _disable_bifrost_virtual_keys_for_budget(db, budget=budget)
    if budget.owner_scope == "personal" and budget.owner_user_id is not None:
        source = budget.entitlement_source or _USER_FREE_CREDIT_SOURCE
        period_key = budget.entitlement_period_key or _user_free_credit_period_key()
        await store.ensure_free_credit_entitlement(
            db,
            user_id=budget.owner_user_id,
            source=source,
            period_key=period_key,
            included_budget_usd=budget.included_budget_usd,
            budget_subject_id=budget.id,
            status="exhausted",
            last_error_code="managed_credits_exhausted",
            last_error_message="Managed credits are exhausted.",
        )


async def _disable_bifrost_virtual_keys_for_budget(
    db: AsyncSession,
    *,
    budget: AgentGatewayBudgetSubjectRecord,
) -> None:
    materializations = await store.list_active_router_virtual_key_materializations_for_budget(
        db,
        router_kind="bifrost",
        budget_subject_id=budget.id,
    )
    if not materializations:
        return
    client = BifrostAdminClient()
    for materialization in materializations:
        await _disable_bifrost_virtual_key_materialization(
            db,
            client=client,
            materialization=materialization,
            error_code="bifrost_virtual_key_disable_failed",
            raise_on_failure=False,
        )


async def _disable_bifrost_virtual_key_materialization(
    db: AsyncSession,
    *,
    client: BifrostAdminClient,
    materialization: AgentGatewayRouterMaterializationRecord,
    error_code: str,
    raise_on_failure: bool,
) -> bool:
    virtual_key_id = materialization.router_object_id
    if not virtual_key_id:
        return True
    try:
        await client.disable_virtual_key(virtual_key_id)
    except BifrostIntegrationError as exc:
        await store.update_router_materialization_status(
            db,
            materialization_id=materialization.id,
            status="active",
            sync_status="failed",
            last_error_code=error_code,
            last_error_message=_safe_error_message(str(exc), {}),
        )
        if raise_on_failure:
            raise AgentAuthError(
                "Bifrost virtual key could not be disabled.",
                code=error_code,
                status_code=502,
            ) from exc
        return False
    await store.update_router_materialization_status(
        db,
        materialization_id=materialization.id,
        status="disabled",
        sync_status="synced",
        last_error_code=None,
        last_error_message=None,
    )
    return True


async def _disable_bifrost_runtime_materializations_for_selection(
    db: AsyncSession,
    *,
    selection: SandboxAgentAuthSelectionRecord,
) -> None:
    materializations = await store.list_active_runtime_router_materializations_for_selection(
        db,
        router_kind="bifrost",
        selection_id=selection.id,
    )
    if not materializations:
        return
    client = BifrostAdminClient()
    for materialization in materializations:
        await _disable_bifrost_virtual_key_materialization(
            db,
            client=client,
            materialization=materialization,
            error_code="bifrost_selection_virtual_key_disable_failed",
            raise_on_failure=True,
        )


async def _disable_bifrost_router_materializations_for_credential(
    db: AsyncSession,
    *,
    credential: AgentAuthCredentialRecord,
) -> None:
    policy = await store.get_gateway_policy_for_credential(db, credential.id)
    if policy is None:
        return
    materializations = await store.list_active_router_materializations_for_policy(
        db,
        router_kind="bifrost",
        policy_id=policy.id,
    )
    if not materializations:
        return
    provider_credential = await store.get_provider_credential_for_policy(db, policy.id)
    provider_name = (
        _bifrost_provider_name_for_provider_kind(provider_credential.provider_kind)
        if provider_credential is not None
        else None
    )
    client = BifrostAdminClient()
    failures: list[str] = []
    for materialization in materializations:
        router_object_id = materialization.router_object_id
        if not router_object_id:
            continue
        try:
            if materialization.router_object_kind == "virtual_key":
                await client.disable_virtual_key(router_object_id)
            elif materialization.router_object_kind == "provider_key":
                if provider_name is None:
                    continue
                await client.disable_provider_key(
                    provider=provider_name,
                    key_id=router_object_id,
                )
            else:
                continue
            await store.update_router_materialization_status(
                db,
                materialization_id=materialization.id,
                status="disabled",
                sync_status="synced",
                last_error_code=None,
                last_error_message=None,
            )
        except BifrostIntegrationError as exc:
            failures.append(str(exc))
            await store.update_router_materialization_status(
                db,
                materialization_id=materialization.id,
                status="active",
                sync_status="failed",
                last_error_code="bifrost_materialization_disable_failed",
                last_error_message=_safe_error_message(str(exc), {}),
            )
    if failures:
        raise AgentAuthError(
            "Credential revocation could not disable all Bifrost router materializations.",
            code="bifrost_revocation_failed",
            status_code=502,
        )


async def reconcile_agent_gateway_runtime_grant_freshness(
    db: AsyncSession,
    *,
    limit: int = 50,
    refresh_window: timedelta = timedelta(days=2),
) -> RuntimeGrantFreshnessReconcilePassResult:
    if limit <= 0 or not settings.agent_gateway_enabled:
        return RuntimeGrantFreshnessReconcilePassResult(
            grants_checked=0,
            targets_refreshed=0,
            grants_skipped=0,
            grants_failed=0,
        )
    now = utcnow()
    grants = await store.list_runtime_grants_needing_rotation(
        db,
        now=now,
        expires_before=now + refresh_window,
        limit=limit,
    )
    refreshed_targets: set[tuple[UUID, UUID]] = set()
    skipped = 0
    failed = 0
    for grant in grants:
        key = (grant.sandbox_profile_id, grant.target_id)
        if key in refreshed_targets:
            skipped += 1
            continue
        try:
            profile = await store.get_sandbox_profile(db, grant.sandbox_profile_id)
            if profile is None:
                skipped += 1
                continue
            if grant.issued_profile_revision != profile.agent_auth_revision:
                skipped += 1
                continue
            if profile.primary_target_id != grant.target_id:
                skipped += 1
                continue
            await _mark_target_pending_and_queue_refresh(
                db,
                profile=profile,
                actor_user_id=None,
                reason="runtime_grant_expiring",
                force_restart=False,
            )
            refreshed_targets.add(key)
        except Exception:
            failed += 1
    return RuntimeGrantFreshnessReconcilePassResult(
        grants_checked=len(grants),
        targets_refreshed=len(refreshed_targets),
        grants_skipped=skipped,
        grants_failed=failed,
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
    await _disable_bifrost_router_materializations_for_credential(
        db,
        credential=credential,
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
    if (
        profile.owner_scope == "organization"
        and credential.owner_scope == "personal"
        and credential.credential_kind == "synced_path"
        and credential.owner_user_id != actor_user_id
        and not has_active_share
    ):
        raise AgentAuthError(
            "Credential is not visible to this sandbox profile.",
            code="credential_not_visible",
            status_code=403,
        )
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
    existing_selection = next(
        (
            selection
            for selection in await store.list_selections_for_profile(db, profile.id)
            if selection.agent_kind == agent_kind
        ),
        None,
    )
    selected_revision = credential.revision
    if (
        existing_selection is not None
        and existing_selection.credential_id == credential.id
        and existing_selection.credential_share_id == (share.id if share is not None else None)
        and existing_selection.materialization_mode == plan.materialization_mode
        and existing_selection.selected_revision == selected_revision
        and existing_selection.status == "active"
        and existing_selection.last_error_code is None
        and existing_selection.last_error_message is None
        and not force_restart
    ):
        return existing_selection
    if (
        existing_selection is not None
        and existing_selection.status == "active"
        and existing_selection.materialization_mode == "gateway_env"
        and (
            existing_selection.credential_id != credential.id
            or existing_selection.credential_share_id != (share.id if share is not None else None)
            or existing_selection.materialization_mode != plan.materialization_mode
            or existing_selection.selected_revision != selected_revision
        )
    ):
        await _disable_bifrost_runtime_materializations_for_selection(
            db,
            selection=existing_selection,
        )
    selection = await store.upsert_selection(
        db,
        sandbox_profile_id=profile.id,
        owner_scope=profile.owner_scope,
        agent_kind=agent_kind,
        credential_id=credential.id,
        credential_share_id=share.id if share is not None else None,
        materialization_mode=plan.materialization_mode,
        selected_revision=selected_revision,
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


async def worker_agent_auth_materialization_plan(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    sandbox_profile_id: UUID,
    command_id: UUID,
    revision: int,
    lease_id: str,
) -> WorkerAgentAuthMaterializationPlan:
    await require_current_managed_worker_slot(db, auth=auth)
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
            slotGeneration=auth.slot_generation,
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
    target_state = await _require_agent_auth_target_state(
        db,
        profile=profile,
        auth=auth,
        command=command,
    )
    selections = []
    selections.extend(_worker_cleanup_plans_from_state(target_state))
    for selection in await store.list_selections_for_profile(db, profile.id):
        cleanup_plan = await _worker_cleanup_selection_plan(db, selection)
        if cleanup_plan is not None:
            selections.append(cleanup_plan)
            continue
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
        # The command was leased by the current managed worker slot. A stale
        # target state may still reference an older slot while this refresh is
        # repairing it, so the worker plan must echo the leased worker slot.
        slotGeneration=auth.slot_generation,
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
    await require_current_managed_worker_slot(db, auth=auth)
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
        missing_cleanup_paths = await _missing_worker_cleanup_paths(
            db,
            sandbox_profile_id=profile.id,
            target_id=auth.target_id,
            applied_cleanup_paths=set(body.applied_cleanup_paths),
        )
        if missing_cleanup_paths:
            status = "failed"
            applied_revision = existing_applied
            error_code = "agent_auth_cleanup_incomplete"
            error_message = "Agent auth cleanup did not report all required paths: " + ", ".join(
                missing_cleanup_paths
            )
        elif applied_revision < desired_revision:
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


async def _missing_worker_cleanup_paths(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    applied_cleanup_paths: set[str],
) -> list[str]:
    expected: set[str] = set()
    state = await store.get_target_state(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
    )
    if state is not None:
        for entry in _pending_cleanup_entries_from_json(state.pending_cleanup_json):
            expected.update(_cleanup_entry_paths(entry))
    for selection in await store.list_selections_for_profile(db, sandbox_profile_id):
        expected.update(await _cleanup_paths_for_selection(db, selection))
    return sorted(path for path in expected if path not in applied_cleanup_paths)


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
            status=selection.status,
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
            status=selection.status,
            credentialShareId=selection.credential_share_id,
            gateway=None,
            syncedFiles=synced_files,
        )
    raise AgentAuthError(
        "Unsupported materialization mode.",
        code="unsupported_materialization_mode",
        status_code=400,
    )


async def _worker_cleanup_selection_plan(
    db: AsyncSession,
    selection: SandboxAgentAuthSelectionRecord,
) -> WorkerAgentAuthSelectionPlan | None:
    if selection.status != "invalid":
        return None
    if selection.materialization_mode != "synced_files":
        return None
    if selection.last_error_code not in _CLEANUP_SELECTION_ERROR_CODES:
        return None
    cleanup_paths = await _cleanup_paths_for_selection(db, selection)
    cleanup = [
        {
            "relativePath": relative_path,
            "reason": selection.last_error_code,
        }
        for relative_path in cleanup_paths
    ]
    if not cleanup:
        return None
    return WorkerAgentAuthSelectionPlan(
        agentKind=selection.agent_kind,
        materializationMode=selection.materialization_mode,
        credentialId=selection.credential_id,
        credentialRevision=selection.selected_revision,
        status=selection.status,
        credentialShareId=selection.credential_share_id,
        gateway=None,
        syncedFiles=WorkerAgentAuthSyncedFilesConfig(
            credentialShareId=selection.credential_share_id,
            envVars={},
            files=[],
            cleanup=cleanup,
        ),
    )


def _worker_cleanup_plans_from_state(
    target_state: SandboxProfileAgentAuthTargetStateRecord,
) -> list[WorkerAgentAuthSelectionPlan]:
    plans: list[WorkerAgentAuthSelectionPlan] = []
    for entry in _pending_cleanup_entries_from_json(target_state.pending_cleanup_json):
        plan = _worker_cleanup_plan_from_entry(entry)
        if plan is not None:
            plans.append(plan)
    return plans


def _worker_cleanup_plan_from_entry(
    entry: dict[str, object],
) -> WorkerAgentAuthSelectionPlan | None:
    try:
        credential_id = UUID(str(entry["credentialId"]))
    except (KeyError, TypeError, ValueError):
        return None
    agent_kind = entry.get("agentKind")
    materialization_mode = entry.get("materializationMode")
    credential_revision = entry.get("credentialRevision")
    if not isinstance(agent_kind, str) or not isinstance(materialization_mode, str):
        return None
    if not isinstance(credential_revision, int) or isinstance(credential_revision, bool):
        return None
    credential_share_id = _optional_uuid_value(entry.get("credentialShareId"))
    cleanup = [
        {"relativePath": path, "reason": entry.get("reason") or "credential_revoked"}
        for path in _cleanup_entry_paths(entry)
    ]
    if not cleanup:
        return None
    return WorkerAgentAuthSelectionPlan(
        agentKind=agent_kind,
        materializationMode=materialization_mode,
        credentialId=credential_id,
        credentialRevision=credential_revision,
        status="invalid",
        credentialShareId=credential_share_id,
        gateway=None,
        syncedFiles=WorkerAgentAuthSyncedFilesConfig(
            credentialShareId=credential_share_id,
            envVars={},
            files=[],
            cleanup=cleanup,
        ),
    )


def _optional_uuid_value(value: object) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _pending_cleanup_entries_from_json(value: str | None) -> tuple[dict[str, object], ...]:
    if not value:
        return ()
    try:
        parsed = json.loads(value)
    except ValueError:
        return ()
    if not isinstance(parsed, list):
        return ()
    return tuple(entry for entry in parsed if isinstance(entry, dict))


def _cleanup_entry_paths(entry: dict[str, object]) -> tuple[str, ...]:
    paths = entry.get("paths")
    if not isinstance(paths, list):
        return ()
    return tuple(sorted({path for path in paths if isinstance(path, str) and path.strip()}))


async def _pending_cleanup_entries_for_selection(
    db: AsyncSession,
    selection: SandboxAgentAuthSelectionRecord,
    *,
    reason: str,
) -> list[dict[str, object]]:
    if reason not in _CLEANUP_SELECTION_ERROR_CODES:
        return []
    if selection.materialization_mode != "synced_files":
        return []
    paths = await _cleanup_paths_from_credential_payload(db, selection)
    if not paths:
        return []
    return [
        {
            "agentKind": selection.agent_kind,
            "credentialId": str(selection.credential_id),
            "credentialRevision": selection.selected_revision,
            "credentialShareId": (
                str(selection.credential_share_id)
                if selection.credential_share_id is not None
                else None
            ),
            "materializationMode": selection.materialization_mode,
            "paths": list(paths),
            "reason": reason,
        }
    ]


def _pending_cleanup_json(entries: Sequence[dict[str, object]] | None) -> str | None:
    if not entries:
        return None
    return json.dumps(list(entries), separators=(",", ":"), sort_keys=True)


async def _cleanup_paths_for_selection(
    db: AsyncSession,
    selection: SandboxAgentAuthSelectionRecord,
) -> tuple[str, ...]:
    if selection.status != "invalid":
        return ()
    if selection.materialization_mode != "synced_files":
        return ()
    if selection.last_error_code not in _CLEANUP_SELECTION_ERROR_CODES:
        return ()
    return await _cleanup_paths_from_credential_payload(db, selection)


async def _cleanup_paths_from_credential_payload(
    db: AsyncSession,
    selection: SandboxAgentAuthSelectionRecord,
) -> tuple[str, ...]:
    credential = await store.get_credential(db, selection.credential_id)
    if credential is None or credential.payload_ciphertext is None:
        return ()
    try:
        payload = _decrypt_synced_payload(credential)
    except AgentAuthError:
        return ()
    files = payload.get("files")
    if not isinstance(files, dict):
        return ()
    allowed_paths = set(_native_auth_file_paths(selection.agent_kind))
    return tuple(sorted(path for path in files if isinstance(path, str) and path in allowed_paths))


def _native_auth_file_paths(agent_kind: str) -> tuple[str, ...]:
    if agent_kind == "claude":
        return tuple(sorted(CLAUDE_ALLOWED_AUTH_FILES))
    if agent_kind == "codex":
        return tuple(sorted(CODEX_ALLOWED_AUTH_FILES))
    if agent_kind == "gemini":
        return tuple(sorted(GEMINI_ALLOWED_AUTH_FILES))
    if agent_kind == "opencode":
        return tuple(sorted(_OPENCODE_ALLOWED_AUTH_FILES))
    return ()


def _reject_unallowed_selection_protected_env(
    *,
    agent_kind: str,
    materialization_mode: str,
    protected_env: dict[str, str],
) -> None:
    try:
        reject_unallowed_protected_env(
            agent_kind=agent_kind,
            materialization_mode=materialization_mode,
            keys=set(protected_env),
        )
    except ValueError as exc:
        raise AgentAuthError(
            str(exc),
            code="agent_auth_protected_env_not_allowed",
            status_code=409,
        ) from exc


async def _issue_bifrost_runtime_virtual_key_for_selection(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    profile: SandboxProfileRecord,
    selection: SandboxAgentAuthSelectionRecord,
) -> BifrostRuntimeVirtualKeyResult:
    if auth.cloud_sandbox_id is None or auth.slot_generation is None:
        raise AgentAuthError(
            "Bifrost runtime virtual keys require an active sandbox slot.",
            code="agent_gateway_slot_required",
            status_code=409,
        )
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

    provider_key = await _bifrost_provider_key_for_policy(
        db,
        policy=policy,
        agent_kind=selection.agent_kind,
    )
    provider = str(provider_key["provider"])
    provider_key_id = str(provider_key["key_id"])
    models = tuple(str(model) for model in provider_key.get("models", ()) if str(model))
    if not models:
        raise AgentAuthError(
            "Bifrost provider key does not expose any models.",
            code="bifrost_models_not_configured",
            status_code=409,
        )
    budget_limit = await _bifrost_budget_limit_for_runtime_key(db, policy=policy)
    fingerprint = _bifrost_virtual_key_fingerprint(
        provider=provider,
        provider_key_id=provider_key_id,
        provider_key_fingerprint=(
            str(provider_key["provider_key_fingerprint"])
            if provider_key.get("provider_key_fingerprint") is not None
            else None
        ),
        models=models,
        budget_limit=budget_limit,
        agent_kind=selection.agent_kind,
        policy_id=policy.id,
    )
    existing = await store.get_runtime_router_materialization(
        db,
        router_kind="bifrost",
        selection_id=selection.id,
        target_id=auth.target_id,
        cloud_sandbox_id=auth.cloud_sandbox_id,
        slot_generation=auth.slot_generation,
    )
    if (
        existing is not None
        and existing.status == "active"
        and existing.sync_status == "synced"
        and existing.sync_fingerprint == fingerprint
        and existing.router_object_id
        and existing.router_object_secret_ciphertext
    ):
        return BifrostRuntimeVirtualKeyResult(
            virtual_key=decrypt_text(existing.router_object_secret_ciphertext),
            virtual_key_id=existing.router_object_id,
            expires_at_iso=(utcnow() + _GATEWAY_GRANT_TTL).isoformat(),
        )
    client = BifrostAdminClient()
    if (
        existing is not None
        and existing.status == "active"
        and existing.router_object_id
        and (
            existing.sync_fingerprint != fingerprint
            or existing.sync_status != "synced"
        )
    ):
        await _disable_bifrost_virtual_key_materialization(
            db,
            client=client,
            materialization=existing,
            error_code="bifrost_virtual_key_rotation_failed",
            raise_on_failure=True,
        )
        existing = None

    provider_config: dict[str, object] = {
        "provider": provider,
        "weight": 1.0,
        "allowed_models": list(models),
        "blacklisted_models": [],
        "key_ids": [provider_key_id],
    }
    if budget_limit is not None:
        provider_config["budgets"] = [
            {
                "max_limit": float(Decimal(budget_limit)),
                "reset_duration": "100Y",
            }
        ]
    name = (
        f"proliferate-{selection.agent_kind}-{selection.id.hex[:12]}-"
        f"{auth.cloud_sandbox_id.hex[:12]}-{auth.slot_generation}-{secrets.token_hex(4)}"
    )
    description = json.dumps(
        {
            "credentialId": str(credential.id),
            "policyId": str(policy.id),
            "sandboxProfileId": str(profile.id),
            "targetId": str(auth.target_id),
            "cloudSandboxId": str(auth.cloud_sandbox_id),
            "slotGeneration": auth.slot_generation,
        },
        sort_keys=True,
    )
    secret: str | None = None
    result = await client.create_virtual_key(
        name=name,
        description=description,
        provider_configs=[provider_config],
        budgets=[],
        is_active=True,
    )
    if not result.virtual_key:
        raise BifrostIntegrationError("Bifrost did not return the new virtual key value.")
    secret = result.virtual_key
    virtual_key_id = result.virtual_key_id

    materialization = await store.upsert_router_materialization(
        db,
        router_kind="bifrost",
        router_object_kind="virtual_key",
        object_scope="runtime_selection",
        policy_id=policy.id,
        provider_credential_id=None,
        budget_subject_id=policy.budget_subject_id,
        selection_id=selection.id,
        sandbox_profile_id=profile.id,
        target_id=auth.target_id,
        cloud_sandbox_id=auth.cloud_sandbox_id,
        slot_generation=auth.slot_generation,
        agent_kind=selection.agent_kind,
        protocol_facade=plan.protocol_facade,
        router_object_id=virtual_key_id,
        router_object_secret_ciphertext=encrypt_text(secret),
        router_object_secret_ciphertext_key_id=AGENT_GATEWAY_CIPHERTEXT_KEY_ID,
        sync_status="synced",
        sync_fingerprint=fingerprint,
        status="active",
    )
    if not materialization.router_object_id:
        raise BifrostIntegrationError("Bifrost virtual key materialization is missing an id.")
    return BifrostRuntimeVirtualKeyResult(
        virtual_key=secret,
        virtual_key_id=materialization.router_object_id,
        expires_at_iso=(utcnow() + _GATEWAY_GRANT_TTL).isoformat(),
    )


async def _bifrost_provider_key_for_policy(
    db: AsyncSession,
    *,
    policy: AgentGatewayPolicyRecord,
    agent_kind: str,
) -> dict[str, object]:
    provider_kind = "proliferate_bedrock_pool"
    if policy.policy_kind == "proliferate_managed":
        if policy.budget_subject_id is None:
            raise AgentAuthError(
                "Managed gateway policy is missing a budget subject.",
                code="managed_budget_missing",
                status_code=409,
            )
        budget = await store.get_budget_subject(db, policy.budget_subject_id)
        if budget is None or budget.status == "revoked":
            raise AgentAuthError(
                "Managed budget subject is not available.",
                code="managed_budget_missing",
                status_code=409,
            )
        if budget.litellm_sync_status != "synced":
            budget = await _reconcile_managed_budget_subject(db, budget=budget)
        if budget.status == "exhausted":
            await _disable_bifrost_virtual_keys_for_budget(db, budget=budget)
            raise AgentAuthError(
                "Managed credits are exhausted.",
                code="managed_credits_exhausted",
                status_code=402,
            )
        if budget.status == "invalid":
            await _disable_bifrost_virtual_keys_for_budget(db, budget=budget)
            raise AgentAuthError(
                "Managed credits need review.",
                code=budget.last_error_code or "managed_budget_invalid",
                status_code=409,
            )
        deployments = _gateway_deployments_for_credential(
            agent_kind=agent_kind,
            provider_kind="proliferate_bedrock_pool",
        )
        if not deployments:
            raise AgentAuthError(
                "No Bifrost managed-credit models are configured for this agent.",
                code="bifrost_models_not_configured",
                status_code=409,
            )
        materialization = await _ensure_bifrost_provider_key_for_managed_budget(
            db,
            budget=budget,
            deployments=deployments,
        )
        provider = _bifrost_managed_provider_name()
    else:
        provider_credential = await store.get_provider_credential_for_policy(db, policy.id)
        if provider_credential is None:
            raise AgentAuthError(
                "Gateway provider credential is not configured.",
                code="provider_credential_missing",
                status_code=409,
            )
        provider_kind = provider_credential.provider_kind
        deployments = _gateway_deployments_for_credential(
            agent_kind=agent_kind,
            provider_kind=provider_kind,
        )
        if not deployments:
            raise AgentAuthError(
                "No Bifrost BYOK models are configured for this agent/provider.",
                code="bifrost_models_not_configured",
                status_code=409,
            )
        materialization = await _ensure_bifrost_policy_provider_key(
            db,
            policy=policy,
            provider_credential=provider_credential,
            deployments=deployments,
        )
        provider = _bifrost_provider_name_for_provider_kind(provider_kind)
    if not materialization.router_object_id:
        raise AgentAuthError(
            "Bifrost provider key is not ready.",
            code="bifrost_provider_key_not_ready",
            status_code=409,
        )
    _ = provider_kind
    return {
        "provider": provider,
        "key_id": materialization.router_object_id,
        "models": tuple(deployment.provider_model for deployment in deployments),
        "provider_key_fingerprint": materialization.sync_fingerprint,
    }


async def _bifrost_budget_limit_for_runtime_key(
    db: AsyncSession,
    *,
    policy: AgentGatewayPolicyRecord,
) -> str | None:
    if policy.policy_kind != "proliferate_managed":
        return None
    if policy.budget_subject_id is None:
        raise AgentAuthError(
            "Managed gateway policy is missing a budget subject.",
            code="managed_budget_missing",
            status_code=409,
        )
    budget = await store.get_budget_subject(db, policy.budget_subject_id)
    if budget is None:
        raise AgentAuthError(
            "Managed budget subject is not available.",
            code="managed_budget_missing",
            status_code=409,
        )
    used = await store.sum_llm_usage_cost_for_budget_subject(
        db,
        budget_subject_id=budget.id,
    )
    remaining = Decimal(budget.included_budget_usd) - used
    if remaining <= 0:
        await store.ensure_managed_budget_subject_for_owner(
            db,
            owner_scope=budget.owner_scope,
            owner_user_id=budget.owner_user_id,
            organization_id=budget.organization_id,
            included_budget_usd=budget.included_budget_usd,
            budget_duration=budget.budget_duration,
            entitlement_source=budget.entitlement_source,
            entitlement_period_key=budget.entitlement_period_key,
            litellm_team_id=budget.litellm_team_id,
            litellm_sync_status=budget.litellm_sync_status,
            litellm_sync_fingerprint=budget.litellm_sync_fingerprint,
            status="exhausted",
            last_error_code="managed_credits_exhausted",
            last_error_message="Managed credits are exhausted.",
        )
        await _disable_bifrost_virtual_keys_for_budget(db, budget=budget)
        raise AgentAuthError(
            "Managed credits are exhausted.",
            code="managed_credits_exhausted",
            status_code=402,
        )
    return format(remaining, "f")


async def _worker_gateway_config(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    profile: SandboxProfileRecord,
    selection: SandboxAgentAuthSelectionRecord,
) -> WorkerAgentAuthGatewayConfig:
    result = await _issue_bifrost_runtime_virtual_key_for_selection(
        db,
        auth=auth,
        profile=profile,
        selection=selection,
    )
    base = _bifrost_public_base_url()
    if selection.agent_kind == "claude":
        facade_base = f"{base}/anthropic"
        config = WorkerAgentAuthGatewayConfig(
            protocolFacade="anthropic",
            baseUrls={"anthropic": facade_base},
            runtimeGrantToken=result.virtual_key,
            expiresAt=result.expires_at_iso,
            protectedEnv={
                "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST": "1",
                "ANTHROPIC_BASE_URL": facade_base,
                "ANTHROPIC_AUTH_TOKEN": result.virtual_key,
            },
            supportEnv={},
            protectedConfig={},
            supportConfig={},
        )
        _reject_unallowed_selection_protected_env(
            agent_kind=selection.agent_kind,
            materialization_mode=selection.materialization_mode,
            protected_env=config.protected_env,
        )
        return config
    if selection.agent_kind == "codex":
        facade_base = f"{base}/openai/v1"
        config = WorkerAgentAuthGatewayConfig(
            protocolFacade="openai",
            baseUrls={"openai": facade_base},
            runtimeGrantToken=result.virtual_key,
            expiresAt=result.expires_at_iso,
            protectedEnv={"CODEX_API_KEY": result.virtual_key},
            supportEnv={},
            protectedConfig={
                "codex": {
                    "model_provider_id": "proliferate-bifrost",
                    "model_providers": {
                        "proliferate-bifrost": {
                            "name": "Proliferate Bifrost",
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
        _reject_unallowed_selection_protected_env(
            agent_kind=selection.agent_kind,
            materialization_mode=selection.materialization_mode,
            protected_env=config.protected_env,
        )
        return config
    if selection.agent_kind == "opencode":
        facade_base = f"{base}/openai/v1"
        config = WorkerAgentAuthGatewayConfig(
            protocolFacade="openai",
            baseUrls={"openai": facade_base},
            runtimeGrantToken=result.virtual_key,
            expiresAt=result.expires_at_iso,
            protectedEnv={
                "OPENAI_API_KEY": result.virtual_key,
                "OPENAI_BASE_URL": facade_base,
            },
            supportEnv={},
            protectedConfig={},
            supportConfig={},
        )
        _reject_unallowed_selection_protected_env(
            agent_kind=selection.agent_kind,
            materialization_mode=selection.materialization_mode,
            protected_env=config.protected_env,
        )
        return config
    if selection.agent_kind == "gemini":
        facade_base = f"{base}/genai"
        config = WorkerAgentAuthGatewayConfig(
            protocolFacade="genai",
            baseUrls={"genai": facade_base},
            runtimeGrantToken=result.virtual_key,
            expiresAt=result.expires_at_iso,
            protectedEnv={
                "GEMINI_API_KEY": result.virtual_key,
                "GOOGLE_GEMINI_BASE_URL": facade_base,
            },
            supportEnv={},
            protectedConfig={},
            supportConfig={},
        )
        _reject_unallowed_selection_protected_env(
            agent_kind=selection.agent_kind,
            materialization_mode=selection.materialization_mode,
            protected_env=config.protected_env,
        )
        return config
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
    payload = _decrypt_synced_payload(credential)
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
    _reject_unallowed_selection_protected_env(
        agent_kind=selection.agent_kind,
        materialization_mode=selection.materialization_mode,
        protected_env=env_vars,
    )
    return WorkerAgentAuthSyncedFilesConfig(
        credentialShareId=selection.credential_share_id,
        envVars=env_vars,
        files=files,
        cleanup=[],
    )


def _decrypt_synced_payload(credential: AgentAuthCredentialRecord) -> dict[str, object]:
    if credential.payload_ciphertext is None:
        raise AgentAuthError(
            "Synced credential is missing its source payload.",
            code="synced_credential_source_missing",
            status_code=409,
        )
    payload = decrypt_json(credential.payload_ciphertext)
    if not isinstance(payload, dict) or payload.get("provider") != credential.agent_kind:
        raise AgentAuthError(
            "Synced credential payload is invalid.",
            code="synced_credential_payload_invalid",
            status_code=409,
        )
    return payload


def _bifrost_public_base_url() -> str:
    base = settings.agent_gateway_bifrost_public_base_url.strip().rstrip("/")
    if not base:
        raise AgentAuthError(
            "Bifrost public base URL is not configured.",
            code="bifrost_public_base_url_missing",
            status_code=409,
        )
    return base


def _bifrost_admin_ready() -> bool:
    return bool(settings.agent_gateway_bifrost_base_url.strip())


async def _reconcile_bifrost_managed_budget_subject(
    db: AsyncSession,
    *,
    budget: AgentGatewayBudgetSubjectRecord,
) -> AgentGatewayBudgetSubjectRecord:
    if budget.owner_scope == "personal":
        entitlement_source = budget.entitlement_source or _USER_FREE_CREDIT_SOURCE
        entitlement_period_key = budget.entitlement_period_key or _user_free_credit_period_key()
        entitlement = await store.get_free_credit_entitlement_for_budget(
            db,
            budget.id,
            source=entitlement_source,
            period_key=entitlement_period_key,
        )
        included_budget_usd = (
            _budget_amount(entitlement.included_budget_usd)
            if entitlement is not None
            else _user_free_credit_entitlement_budget(require_positive=False)
        )
        budget_duration = budget.budget_duration
    else:
        if budget.organization_id is None:
            return await _mark_bifrost_budget_failed(
                db,
                budget=budget,
                included_budget_usd=budget.included_budget_usd,
                error_code="managed_budget_owner_invalid",
                error_message="Managed budget subject is missing its organization.",
            )
        included_budget_usd = await _organization_managed_credit_entitlement_budget(
            db,
            budget.organization_id,
            require_positive=False,
        )
        entitlement_source = budget.entitlement_source
        entitlement_period_key = budget.entitlement_period_key
        budget_duration = budget.budget_duration or AGENT_GATEWAY_BUDGET_DURATION_V1

    deployments = _bifrost_deployments_for_managed_credits()
    if not deployments:
        return await _mark_bifrost_budget_failed(
            db,
            budget=budget,
            included_budget_usd=included_budget_usd,
            budget_duration=budget_duration,
            entitlement_source=entitlement_source,
            entitlement_period_key=entitlement_period_key,
            error_code="managed_credit_models_not_configured",
            error_message="No managed-credit model deployments are configured.",
        )

    sync_status = "failed"
    status = "invalid"
    fingerprint = None
    error_code = "bifrost_not_configured"
    error_message = "Bifrost provisioning is not configured."
    router_object_id = budget.litellm_team_id
    if settings.agent_gateway_enabled and _bifrost_admin_ready():
        try:
            materialization = await _ensure_bifrost_provider_key_for_managed_budget(
                db,
                budget=budget,
                deployments=deployments,
            )
            router_object_id = materialization.router_object_id
            used = await store.sum_llm_usage_cost_for_budget_subject(
                db,
                budget_subject_id=budget.id,
            )
            sync_status = "synced"
            status = (
                "exhausted"
                if Decimal(included_budget_usd) <= 0 or used >= Decimal(included_budget_usd)
                else "ready"
            )
            fingerprint = materialization.sync_fingerprint
            error_code = None
            error_message = None
        except (BifrostIntegrationError, AgentAuthError) as exc:
            error_code = "bifrost_provisioning_failed"
            error_message = _safe_error_message(str(exc), {})

    return await store.ensure_managed_budget_subject_for_owner(
        db,
        owner_scope=budget.owner_scope,
        owner_user_id=budget.owner_user_id,
        organization_id=budget.organization_id,
        included_budget_usd=included_budget_usd,
        budget_duration=budget_duration,
        entitlement_source=entitlement_source,
        entitlement_period_key=entitlement_period_key,
        litellm_team_id=router_object_id,
        litellm_sync_status=sync_status,
        litellm_sync_fingerprint=fingerprint,
        status=status,
        last_error_code=error_code,
        last_error_message=error_message,
    )


async def _mark_bifrost_budget_failed(
    db: AsyncSession,
    *,
    budget: AgentGatewayBudgetSubjectRecord,
    included_budget_usd: str,
    error_code: str,
    error_message: str,
    budget_duration: str | None = None,
    entitlement_source: str | None = None,
    entitlement_period_key: str | None = None,
) -> AgentGatewayBudgetSubjectRecord:
    return await store.ensure_managed_budget_subject_for_owner(
        db,
        owner_scope=budget.owner_scope,
        owner_user_id=budget.owner_user_id,
        organization_id=budget.organization_id,
        included_budget_usd=included_budget_usd,
        budget_duration=budget_duration if budget_duration is not None else budget.budget_duration,
        entitlement_source=(
            entitlement_source if entitlement_source is not None else budget.entitlement_source
        ),
        entitlement_period_key=(
            entitlement_period_key
            if entitlement_period_key is not None
            else budget.entitlement_period_key
        ),
        litellm_team_id=budget.litellm_team_id,
        litellm_sync_status="failed",
        litellm_sync_fingerprint=budget.litellm_sync_fingerprint,
        status="invalid",
        last_error_code=error_code,
        last_error_message=error_message,
    )


async def _ensure_bifrost_provider_key_for_managed_budget(
    db: AsyncSession,
    *,
    budget: AgentGatewayBudgetSubjectRecord,
    deployments: Sequence[GatewayModelDeploymentRequest],
) -> store.AgentGatewayRouterMaterializationRecord:
    key_plan = _bifrost_provider_key_plan(
        provider_kind="proliferate_bedrock_pool",
        provider_payload={},
        deployments=deployments,
        object_id=str(budget.id),
        display_name=f"Proliferate managed credits {budget.id}",
    )
    fingerprint = _bifrost_provider_key_fingerprint(key_plan)
    existing = await store.get_router_materialization_by_object_id(
        db,
        router_kind="bifrost",
        router_object_kind="provider_key",
        router_object_id=str(key_plan["key_id"]),
    )
    if (
        existing is not None
        and existing.object_scope == "budget_subject"
        and existing.budget_subject_id == budget.id
        and existing.sync_status == "synced"
        and existing.sync_fingerprint == fingerprint
        and existing.router_object_id == key_plan["key_id"]
    ):
        return existing
    await store.upsert_router_materialization(
        db,
        router_kind="bifrost",
        router_object_kind="provider_key",
        object_scope="budget_subject",
        policy_id=None,
        provider_credential_id=None,
        budget_subject_id=budget.id,
        selection_id=None,
        sandbox_profile_id=None,
        target_id=None,
        cloud_sandbox_id=None,
        slot_generation=None,
        agent_kind=None,
        protocol_facade=None,
        router_object_id=key_plan["key_id"],
        router_object_secret_ciphertext=None,
        router_object_secret_ciphertext_key_id=None,
        sync_status="pending",
        sync_fingerprint=fingerprint,
        status="active",
    )
    result = await BifrostAdminClient().upsert_provider_key(
        provider=str(key_plan["provider"]),
        key_id=str(key_plan["key_id"]),
        name=str(key_plan["name"]),
        value=key_plan.get("value") if isinstance(key_plan.get("value"), str) else None,
        models=tuple(str(item) for item in key_plan["models"]),
        aliases=key_plan.get("aliases") if isinstance(key_plan.get("aliases"), dict) else None,
        bedrock_key_config=(
            key_plan.get("bedrock_key_config")
            if isinstance(key_plan.get("bedrock_key_config"), dict)
            else None
        ),
        enabled=True,
    )
    return await store.upsert_router_materialization(
        db,
        router_kind="bifrost",
        router_object_kind="provider_key",
        object_scope="budget_subject",
        policy_id=None,
        provider_credential_id=None,
        budget_subject_id=budget.id,
        selection_id=None,
        sandbox_profile_id=None,
        target_id=None,
        cloud_sandbox_id=None,
        slot_generation=None,
        agent_kind=None,
        protocol_facade=None,
        router_object_id=result.key_id,
        router_object_secret_ciphertext=None,
        router_object_secret_ciphertext_key_id=None,
        sync_status="synced",
        sync_fingerprint=fingerprint,
        status="active",
    )


async def _ensure_bifrost_policy_provider_key(
    db: AsyncSession,
    *,
    policy: AgentGatewayPolicyRecord,
    provider_credential: AgentGatewayProviderCredentialRecord,
    deployments: Sequence[GatewayModelDeploymentRequest],
) -> store.AgentGatewayRouterMaterializationRecord:
    payload = decrypt_json(provider_credential.payload_ciphertext)
    provider_payload = {str(key): str(value) for key, value in payload.items()}
    key_plan = _bifrost_provider_key_plan(
        provider_kind=provider_credential.provider_kind,
        provider_payload=provider_payload,
        deployments=deployments,
        object_id=str(policy.id),
        display_name=f"Credential {policy.credential_id}",
    )
    fingerprint = _bifrost_provider_key_fingerprint(key_plan)
    existing = await store.get_router_materialization_by_object_id(
        db,
        router_kind="bifrost",
        router_object_kind="provider_key",
        router_object_id=str(key_plan["key_id"]),
    )
    if (
        existing is not None
        and existing.object_scope == "policy"
        and existing.policy_id == policy.id
        and existing.sync_status == "synced"
        and existing.sync_fingerprint == fingerprint
        and existing.router_object_id == key_plan["key_id"]
    ):
        return existing
    await store.upsert_router_materialization(
        db,
        router_kind="bifrost",
        router_object_kind="provider_key",
        object_scope="policy",
        policy_id=policy.id,
        provider_credential_id=provider_credential.id,
        budget_subject_id=policy.budget_subject_id,
        selection_id=None,
        sandbox_profile_id=None,
        target_id=None,
        cloud_sandbox_id=None,
        slot_generation=None,
        agent_kind=None,
        protocol_facade=None,
        router_object_id=key_plan["key_id"],
        router_object_secret_ciphertext=None,
        router_object_secret_ciphertext_key_id=None,
        sync_status="pending",
        sync_fingerprint=fingerprint,
        status="active",
    )
    result = await BifrostAdminClient().upsert_provider_key(
        provider=str(key_plan["provider"]),
        key_id=str(key_plan["key_id"]),
        name=str(key_plan["name"]),
        value=key_plan.get("value") if isinstance(key_plan.get("value"), str) else None,
        models=tuple(str(item) for item in key_plan["models"]),
        aliases=key_plan.get("aliases") if isinstance(key_plan.get("aliases"), dict) else None,
        bedrock_key_config=(
            key_plan.get("bedrock_key_config")
            if isinstance(key_plan.get("bedrock_key_config"), dict)
            else None
        ),
        enabled=True,
    )
    return await store.upsert_router_materialization(
        db,
        router_kind="bifrost",
        router_object_kind="provider_key",
        object_scope="policy",
        policy_id=policy.id,
        provider_credential_id=provider_credential.id,
        budget_subject_id=policy.budget_subject_id,
        selection_id=None,
        sandbox_profile_id=None,
        target_id=None,
        cloud_sandbox_id=None,
        slot_generation=None,
        agent_kind=None,
        protocol_facade=None,
        router_object_id=result.key_id,
        router_object_secret_ciphertext=None,
        router_object_secret_ciphertext_key_id=None,
        sync_status="synced",
        sync_fingerprint=fingerprint,
        status="active",
    )


def _bifrost_provider_key_plan(
    *,
    provider_kind: str,
    provider_payload: dict[str, str],
    deployments: Sequence[GatewayModelDeploymentRequest],
    object_id: str,
    display_name: str,
) -> dict[str, object]:
    models = [deployment.provider_model for deployment in deployments]
    if provider_kind == "proliferate_bedrock_pool":
        return _bifrost_managed_provider_key_plan(
            object_id=object_id,
            display_name=display_name,
            models=models,
        )
    if provider_kind == "anthropic_api_key":
        return {
            "provider": "anthropic",
            "key_id": f"proliferate-policy-{object_id}",
            "name": display_name,
            "value": provider_payload["apiKey"],
            "models": models,
            "aliases": {},
        }
    if provider_kind == "openai_api_key":
        return {
            "provider": "openai",
            "key_id": f"proliferate-policy-{object_id}",
            "name": display_name,
            "value": provider_payload["apiKey"],
            "models": models,
            "aliases": {},
        }
    if provider_kind == "gemini_api_key":
        return {
            "provider": "gemini",
            "key_id": f"proliferate-policy-{object_id}",
            "name": display_name,
            "value": provider_payload["apiKey"],
            "models": models,
            "aliases": {},
        }
    if provider_kind == "bedrock_assume_role":
        return {
            "provider": "bedrock",
            "key_id": f"proliferate-policy-{object_id}",
            "name": display_name,
            "value": None,
            "models": models,
            "aliases": {},
            "bedrock_key_config": {
                "role_arn": bifrost_env_var(provider_payload["roleArn"]),
                "external_id": bifrost_env_var(provider_payload["externalId"]),
                "region": bifrost_env_var(provider_payload["region"]),
                "session_name": bifrost_env_var("proliferate-agent-gateway"),
            },
        }
    raise BifrostIntegrationError(f"Provider kind is not supported by Bifrost: {provider_kind}.")


def _bifrost_provider_name_for_provider_kind(provider_kind: str) -> str:
    if provider_kind == "proliferate_bedrock_pool":
        return _bifrost_managed_provider_name()
    if provider_kind == "anthropic_api_key":
        return "anthropic"
    if provider_kind == "openai_api_key":
        return "openai"
    if provider_kind == "gemini_api_key":
        return "gemini"
    if provider_kind == "bedrock_assume_role":
        return "bedrock"
    raise BifrostIntegrationError(f"Provider kind is not supported by Bifrost: {provider_kind}.")


def _bifrost_managed_provider_key_plan(
    *,
    object_id: str,
    display_name: str,
    models: Sequence[str],
) -> dict[str, object]:
    region = settings.agent_gateway_managed_bedrock_region.strip()
    role_arn = settings.agent_gateway_managed_bedrock_role_arn.strip()
    if region and role_arn:
        config: dict[str, object] = {
            "role_arn": bifrost_env_var(role_arn),
            "region": bifrost_env_var(region),
            "session_name": bifrost_env_var("proliferate-managed-credits"),
        }
        external_id = settings.agent_gateway_managed_bedrock_external_id.strip()
        if external_id:
            config["external_id"] = bifrost_env_var(external_id)
        return {
            "provider": "bedrock",
            "key_id": f"proliferate-managed-{object_id}",
            "name": display_name,
            "value": None,
            "models": list(models),
            "aliases": {},
            "bedrock_key_config": config,
        }
    if settings.agent_gateway_managed_anthropic_api_key.strip():
        return {
            "provider": "anthropic",
            "key_id": f"proliferate-managed-{object_id}",
            "name": display_name,
            "value": settings.agent_gateway_managed_anthropic_api_key.strip(),
            "models": list(models),
            "aliases": {},
        }
    if settings.agent_gateway_managed_openai_api_key.strip():
        return {
            "provider": "openai",
            "key_id": f"proliferate-managed-{object_id}",
            "name": display_name,
            "value": settings.agent_gateway_managed_openai_api_key.strip(),
            "models": list(models),
            "aliases": {},
        }
    if settings.agent_gateway_managed_gemini_api_key.strip():
        return {
            "provider": "gemini",
            "key_id": f"proliferate-managed-{object_id}",
            "name": display_name,
            "value": settings.agent_gateway_managed_gemini_api_key.strip(),
            "models": list(models),
            "aliases": {},
        }
    raise BifrostIntegrationError("No managed provider credential is configured for Bifrost.")


def _bifrost_provider_key_fingerprint(plan: dict[str, object]) -> str:
    payload = {
        key: value
        for key, value in plan.items()
        if key not in {"value", "bedrock_key_config"}
    }
    value = plan.get("value")
    if isinstance(value, str) and value:
        payload["value_sha256"] = hashlib.sha256(value.encode("utf-8")).hexdigest()
    if "bedrock_key_config" in plan:
        encoded_bedrock_config = json.dumps(
            plan["bedrock_key_config"],
            default=str,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        payload["bedrock_key_config_sha256"] = hashlib.sha256(
            encoded_bedrock_config
        ).hexdigest()
    encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _bifrost_virtual_key_fingerprint(
    *,
    provider: str,
    provider_key_id: str,
    provider_key_fingerprint: str | None,
    models: Sequence[str],
    budget_limit: str | None,
    agent_kind: str,
    policy_id: UUID,
) -> str:
    payload = {
        "agentKind": agent_kind,
        "budgetLimit": budget_limit,
        "models": sorted(models),
        "policyId": str(policy_id),
        "provider": provider,
        "providerKeyFingerprint": provider_key_fingerprint,
        "providerKeyId": provider_key_id,
    }
    encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _bifrost_deployments_for_managed_credits() -> tuple[GatewayModelDeploymentRequest, ...]:
    provider = _bifrost_managed_provider_name()
    if provider == "openai":
        model = "gpt-5.5"
    elif provider == "gemini":
        model = "gemini-2.5-pro"
    elif provider == "anthropic":
        model = "claude-sonnet-4-6"
    else:
        model = "us.anthropic.claude-sonnet-4-6"
    return (
        GatewayModelDeploymentRequest(
            publicModelName=model,
            providerModel=model,
        ),
    )


def _bifrost_managed_provider_name() -> str:
    if (
        settings.agent_gateway_managed_bedrock_region.strip()
        and settings.agent_gateway_managed_bedrock_role_arn.strip()
    ):
        return "bedrock"
    if settings.agent_gateway_managed_anthropic_api_key.strip():
        return "anthropic"
    if settings.agent_gateway_managed_openai_api_key.strip():
        return "openai"
    if settings.agent_gateway_managed_gemini_api_key.strip():
        return "gemini"
    return "bedrock"


async def _reconcile_managed_budget_subject(
    db: AsyncSession,
    *,
    budget: AgentGatewayBudgetSubjectRecord,
) -> AgentGatewayBudgetSubjectRecord:
    return await _reconcile_bifrost_managed_budget_subject(db, budget=budget)


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
    if credential.owner_scope != budget.owner_scope:
        raise AgentAuthError(
            "Managed credential and budget subject owners do not match.",
            code="managed_budget_owner_mismatch",
            status_code=500,
        )
    if credential.owner_user_id != budget.owner_user_id:
        raise AgentAuthError(
            "Managed credential and budget subject users do not match.",
            code="managed_budget_owner_mismatch",
            status_code=500,
        )
    if credential.organization_id != budget.organization_id:
        raise AgentAuthError(
            "Managed credential and budget subject organizations do not match.",
            code="managed_budget_owner_mismatch",
            status_code=500,
        )
    virtual_key_id = existing_policy.litellm_virtual_key_id if existing_policy else None
    virtual_key_ciphertext = (
        existing_policy.litellm_virtual_key_ciphertext if existing_policy else None
    )
    virtual_key_ciphertext_key_id = (
        existing_policy.litellm_virtual_key_ciphertext_key_id if existing_policy else None
    )
    return await store.ensure_gateway_policy(
        db,
        credential_id=credential.id,
        policy_kind="proliferate_managed",
        owner_scope=credential.owner_scope,
        owner_user_id=credential.owner_user_id,
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
    model_deployments: Sequence[GatewayModelDeploymentRequest],
    existing_policy: AgentGatewayPolicyRecord | None = None,
) -> tuple[AgentGatewayPolicyRecord, str, str, str | None, str | None]:
    sync_status = "failed"
    status = "invalid"
    router_object_id = existing_policy.litellm_team_id if existing_policy else None
    virtual_key_id = existing_policy.litellm_virtual_key_id if existing_policy else None
    virtual_key_ciphertext = (
        existing_policy.litellm_virtual_key_ciphertext if existing_policy else None
    )
    virtual_key_ciphertext_key_id = (
        existing_policy.litellm_virtual_key_ciphertext_key_id if existing_policy else None
    )
    if router_object_id is None:
        virtual_key_id = None
        virtual_key_ciphertext = None
        virtual_key_ciphertext_key_id = None
    error_code = "model_deployments_not_configured"
    error_message = "No gateway model deployments are configured for this credential."
    if not model_deployments:
        fingerprint = _deployment_fingerprint(
            policy_kind=policy_kind,
            router_object_id=router_object_id,
            budget_subject_id=str(budget_subject_id) if budget_subject_id else None,
            provider_kind=provider_kind,
            deployments=model_deployments,
        )
        policy = await store.ensure_gateway_policy(
            db,
            credential_id=credential.id,
            policy_kind=policy_kind,
            owner_scope=owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            budget_subject_id=budget_subject_id,
            litellm_team_id=router_object_id,
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

    fingerprint = _deployment_fingerprint(
        policy_kind=policy_kind,
        router_object_id=router_object_id,
        budget_subject_id=str(budget_subject_id) if budget_subject_id else None,
        provider_kind=provider_kind,
        deployments=model_deployments,
    )
    policy = await store.ensure_gateway_policy(
        db,
        credential_id=credential.id,
        policy_kind=policy_kind,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        budget_subject_id=budget_subject_id,
        litellm_team_id=router_object_id,
        litellm_virtual_key_id=virtual_key_id,
        litellm_virtual_key_ciphertext=virtual_key_ciphertext,
        litellm_virtual_key_ciphertext_key_id=virtual_key_ciphertext_key_id,
        litellm_sync_status="pending",
        litellm_sync_fingerprint=fingerprint,
        status="provisioning",
        last_error_code=None,
        last_error_message=None,
    )
    provider_credential = await store.get_provider_credential_for_policy(db, policy.id)
    if provider_credential is None:
        return (
            await store.ensure_gateway_policy(
                db,
                credential_id=credential.id,
                policy_kind=policy_kind,
                owner_scope=owner_scope,
                owner_user_id=owner_user_id,
                organization_id=organization_id,
                budget_subject_id=budget_subject_id,
                litellm_team_id=router_object_id,
                litellm_virtual_key_id=virtual_key_id,
                litellm_virtual_key_ciphertext=virtual_key_ciphertext,
                litellm_virtual_key_ciphertext_key_id=virtual_key_ciphertext_key_id,
                litellm_sync_status="failed",
                litellm_sync_fingerprint=fingerprint,
                status="invalid",
                last_error_code="provider_credential_missing",
                last_error_message="Gateway provider credential is not configured.",
            ),
            "failed",
            "invalid",
            "provider_credential_missing",
            "Gateway provider credential is not configured.",
        )
    try:
        materialization = await _ensure_bifrost_policy_provider_key(
            db,
            policy=policy,
            provider_credential=provider_credential,
            deployments=model_deployments,
        )
        sync_status = "synced"
        status = "ready"
        router_object_id = materialization.router_object_id
        fingerprint = materialization.sync_fingerprint
        error_code = None
        error_message = None
    except BifrostIntegrationError as exc:
        error_code = "bifrost_provisioning_failed"
        error_message = _safe_error_message(str(exc), provider_payload)
    policy = await store.ensure_gateway_policy(
        db,
        credential_id=credential.id,
        policy_kind=policy_kind,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        budget_subject_id=budget_subject_id,
        litellm_team_id=router_object_id,
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


def _gateway_deployments_for_credential(
    *,
    agent_kind: str,
    provider_kind: str,
) -> tuple[GatewayModelDeploymentRequest, ...]:
    if provider_kind == "proliferate_bedrock_pool" and agent_kind in {
        "claude",
        "codex",
        "opencode",
        "gemini",
    }:
        return _bifrost_deployments_for_managed_credits()
    if agent_kind == "claude":
        if provider_kind in {"bedrock_assume_role", "proliferate_bedrock_pool"}:
            return (
                GatewayModelDeploymentRequest(
                    publicModelName="us.anthropic.claude-sonnet-4-6",
                    providerModel="us.anthropic.claude-sonnet-4-6",
                ),
            )
        if provider_kind == "anthropic_api_key":
            return (
                GatewayModelDeploymentRequest(
                    publicModelName="us.anthropic.claude-sonnet-4-6",
                    providerModel="claude-sonnet-4-6",
                ),
            )
    if agent_kind == "codex" and provider_kind in {"openai_api_key", "openai_compatible"}:
        return (
            GatewayModelDeploymentRequest(
                publicModelName="gpt-5.5",
                providerModel="gpt-5.5",
            ),
        )
    if agent_kind == "opencode" and provider_kind in {"openai_api_key", "openai_compatible"}:
        return (
            GatewayModelDeploymentRequest(
                publicModelName="opencode/big-pickle",
                providerModel="gpt-5.5",
            ),
        )
    if agent_kind == "gemini" and provider_kind == "gemini_api_key":
        return (
            GatewayModelDeploymentRequest(
                publicModelName="gemini-2.5-pro",
                providerModel="gemini-2.5-pro",
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


def _require_gateway_byok_create_allowed(policy_kind: str) -> None:
    verdict = _gateway_byok_policy_verdict(policy_kind)
    if not verdict.allowed:
        raise AgentAuthError(
            verdict.message or "Gateway BYOK provider credentials are disabled.",
            code=verdict.code or "gateway_byok_disabled",
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
    verdict = _gateway_byok_policy_verdict(policy.policy_kind)
    if not verdict.allowed:
        return (
            verdict.code or "gateway_byok_disabled",
            verdict.message or "Gateway BYOK provider credentials are disabled.",
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
    if provider_kind == "gemini_api_key":
        return settings.agent_gateway_gemini_byok_enabled
    if provider_kind == "bedrock_assume_role":
        return settings.agent_gateway_bedrock_byok_enabled
    if provider_kind == "openai_compatible":
        return False
    return False


def _gateway_byok_policy_verdict(policy_kind: str) -> GatewayByokVerdict:
    return gateway_byok_policy_verdict(
        policy_kind=policy_kind,
        gateway_byok_enabled=settings.agent_gateway_byok_enabled,
        personal_byok_enabled=settings.agent_gateway_personal_byok_enabled,
        bifrost_isolation_verified=settings.agent_gateway_bifrost_isolation_verified,
    )


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
        if provider_kind in {"anthropic_api_key", "openai_api_key", "gemini_api_key"}:
            api_key = payload.get("apiKey", "").strip()
            if not api_key:
                raise AgentAuthError(
                    "apiKey is required.", code="missing_api_key", status_code=400
                )
            return _ProviderValidation(
                status="valid",
                redacted_summary={
                    "providerKind": provider_kind,
                    "apiKey": _redact_secret(api_key),
                },
                error_code=None,
                error_message=None,
            )
        if provider_kind == "bedrock_assume_role":
            result = validate_bedrock_assume_role_payload(
                role_arn=payload.get("roleArn", ""),
                external_id=payload.get("externalId", ""),
                region=payload.get("region", ""),
            )
            return _ProviderValidation(
                status="valid",
                redacted_summary={
                    "providerKind": provider_kind,
                    "roleArn": result.role_arn,
                    "region": result.region,
                    "accountId": result.account_id,
                },
                error_code=None,
                error_message=None,
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
    router_object_id: str | None,
    budget_subject_id: str | None,
    provider_kind: str | None,
    deployments: Sequence[GatewayModelDeploymentRequest],
) -> str:
    return fingerprint_gateway_policy_state(
        policy_kind=policy_kind,
        router_object_id=router_object_id,
        budget_subject_id=budget_subject_id,
        provider_kind=provider_kind,
        model_deployments=[
            GatewayModelDeploymentPlan(
                public_model_name=item.public_model_name,
                provider_model=item.provider_model,
                provider_params={},
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
    pending_cleanup = await _pending_cleanup_entries_for_selection(
        db,
        selection,
        reason=reason,
    )
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
            pending_cleanup=pending_cleanup,
        )
    await store.revoke_runtime_grants_for_selection(db, selection_id=selection.id)


async def _mark_target_pending_and_queue_refresh(
    db: AsyncSession,
    *,
    profile: SandboxProfileRecord,
    actor_user_id: UUID | None,
    reason: str,
    force_restart: bool,
    pending_cleanup: Sequence[dict[str, object]] | None = None,
) -> None:
    if profile.primary_target_id is None:
        return
    command = await _queue_agent_auth_refresh_command(
        db,
        profile=profile,
        target_id=profile.primary_target_id,
        actor_user_id=actor_user_id,
        reason=reason,
        force_restart=force_restart,
    )
    pending_kwargs: dict[str, object] = {}
    if pending_cleanup is not None:
        pending_kwargs["pending_cleanup_json"] = _pending_cleanup_json(pending_cleanup)
    await store.upsert_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
        desired_revision=profile.agent_auth_revision,
        applied_revision=None,
        status="pending",
        force_restart_required=force_restart,
        last_command_id=command.id,
        last_worker_id=None,
        last_error_code=None,
        last_error_message=None,
        **pending_kwargs,
    )


async def _ensure_profile_target_refresh_if_needed(
    db: AsyncSession,
    *,
    profile: SandboxProfileRecord,
    actor_user_id: UUID | None,
    reason: str,
) -> None:
    if profile.primary_target_id is None:
        return
    if profile.agent_auth_revision == 0:
        selections = await store.list_selections_for_profile(db, profile.id)
        if not selections:
            return
    state = await store.get_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
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


async def request_agent_auth_refresh_for_profile_target(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    actor_user_id: UUID | None,
    reason: str,
    force_restart: bool,
) -> None:
    profile = await store.get_sandbox_profile(db, sandbox_profile_id)
    if profile is None:
        raise AgentAuthError(
            "Sandbox profile not found.",
            code="sandbox_profile_not_found",
            status_code=404,
        )
    if profile.primary_target_id != target_id:
        raise AgentAuthError(
            "Sandbox profile target does not match the requested target.",
            code="sandbox_profile_target_mismatch",
            status_code=409,
        )
    existing_state = await store.get_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=target_id,
    )
    active_slot = await cloud_sandboxes.load_active_slot_for_profile_target(
        db,
        sandbox_profile_id=profile.id,
        target_id=target_id,
    )
    if _agent_auth_target_state_is_current(
        existing_state,
        profile=profile,
        force_restart=force_restart,
        active_slot=active_slot,
    ):
        return
    command = await _queue_agent_auth_refresh_command(
        db,
        profile=profile,
        target_id=target_id,
        actor_user_id=actor_user_id,
        reason=reason,
        force_restart=force_restart,
        existing_state=existing_state,
        active_slot=active_slot,
    )
    await store.upsert_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=target_id,
        desired_revision=profile.agent_auth_revision,
        applied_revision=None,
        status="pending",
        force_restart_required=force_restart,
        last_command_id=command.id,
        last_worker_id=None,
        last_error_code=None,
        last_error_message=None,
    )


async def _queue_agent_auth_refresh_command(
    db: AsyncSession,
    *,
    profile: SandboxProfileRecord,
    target_id: UUID,
    actor_user_id: UUID | None,
    reason: str,
    force_restart: bool,
    existing_state: SandboxProfileAgentAuthTargetStateRecord | None = None,
    active_slot: cloud_sandboxes.SlotSnapshot | None = None,
) -> commands_store.CloudCommandSnapshot:
    idempotency_scope = f"target:{target_id}:agent-auth-config:{profile.id}"
    base_idempotency_key = (
        f"agent-auth-config:{target_id}:{profile.id}:{profile.agent_auth_revision}:"
        f"{reason}:{int(force_restart)}"
    )
    idempotency_key = base_idempotency_key
    existing = await commands_store.get_command_by_idempotency(
        db,
        idempotency_scope=idempotency_scope,
        idempotency_key=idempotency_key,
    )
    if existing is not None:
        if not _agent_auth_refresh_command_requires_retry(
            existing,
            existing_state=existing_state,
            profile=profile,
            force_restart=force_restart,
            active_slot=active_slot,
        ):
            await publish_command_status_after_commit(db, existing)
            return existing
        idempotency_key = (
            f"{base_idempotency_key}:retry:{_agent_auth_retry_marker(existing_state)}"
        )
        retry_existing = await commands_store.get_command_by_idempotency(
            db,
            idempotency_scope=idempotency_scope,
            idempotency_key=idempotency_key,
        )
        if retry_existing is not None:
            await publish_command_status_after_commit(db, retry_existing)
            return retry_existing
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
                cloud_workspace_id=None,
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


def _agent_auth_target_state_is_current(
    state: SandboxProfileAgentAuthTargetStateRecord | None,
    *,
    profile: SandboxProfileRecord,
    force_restart: bool,
    active_slot: cloud_sandboxes.SlotSnapshot | None = None,
) -> bool:
    slot_matches = (
        active_slot is None
        or (
            state is not None
            and state.active_sandbox_id == active_slot.id
            and state.slot_generation == active_slot.slot_generation
        )
    )
    return (
        not force_restart
        and state is not None
        and state.status == "applied"
        and state.applied_revision is not None
        and state.applied_revision >= profile.agent_auth_revision
        and slot_matches
        and not state.force_restart_required
    )


def _agent_auth_refresh_command_requires_retry(
    command: commands_store.CloudCommandSnapshot,
    *,
    existing_state: SandboxProfileAgentAuthTargetStateRecord | None,
    profile: SandboxProfileRecord,
    force_restart: bool,
    active_slot: cloud_sandboxes.SlotSnapshot | None = None,
) -> bool:
    if command.status not in _TERMINAL_AGENT_AUTH_REFRESH_COMMAND_STATUSES:
        return False
    return not _agent_auth_target_state_is_current(
        existing_state,
        profile=profile,
        force_restart=force_restart,
        active_slot=active_slot,
    )


def _agent_auth_retry_marker(
    existing_state: SandboxProfileAgentAuthTargetStateRecord | None,
) -> str:
    if existing_state is None:
        return "missing"
    marker = (
        f"{existing_state.id}:{existing_state.status}:"
        f"{existing_state.desired_revision}:{existing_state.updated_at.isoformat()}"
    )
    return hashlib.sha256(marker.encode("utf-8")).hexdigest()[:16]


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


def _managed_credit_agent_kinds() -> tuple[CloudAgentKind, ...]:
    configured = [
        item.strip()
        for item in settings.agent_gateway_managed_credit_agent_kinds.split(",")
        if item.strip()
    ]
    agent_kinds = tuple(
        item for item in configured if item in {"claude", "codex", "opencode", "gemini"}
    )
    return agent_kinds or _DEFAULT_MANAGED_CREDIT_AGENT_KINDS


def _user_free_credit_period_key() -> str:
    period = settings.agent_gateway_user_free_credit_period.strip() or "registration"
    if period == "monthly":
        return utcnow().strftime("%Y-%m")
    return "registration"


def _user_free_credit_budget_duration() -> str | None:
    period = settings.agent_gateway_user_free_credit_period.strip() or "registration"
    if period == "monthly":
        return AGENT_GATEWAY_BUDGET_DURATION_V1
    return None


def _user_free_credit_entitlement_budget(*, require_positive: bool = True) -> str:
    budget = _budget_amount(settings.agent_gateway_user_free_credit_usd)
    if require_positive and Decimal(budget) <= 0:
        raise AgentAuthError(
            "Free managed credits are not enabled for this user.",
            code="free_credits_not_entitled",
            status_code=403,
        )
    return budget


async def _organization_managed_credit_entitlement_budget(
    db: AsyncSession,
    organization_id: UUID,
    *,
    require_positive: bool = True,
) -> str:
    subject = await ensure_organization_billing_subject(db, organization_id)
    snapshot = await get_billing_snapshot_for_subject_in_session(db, subject.id)
    if snapshot.has_unlimited_cloud_hours or snapshot.is_unlimited:
        configured_budget = settings.agent_gateway_managed_budget_unlimited_usd
    elif snapshot.plan == BILLING_PLAN_PRO or snapshot.is_paid_cloud:
        configured_budget = settings.agent_gateway_managed_budget_pro_usd
    else:
        configured_budget = settings.agent_gateway_managed_budget_free_usd

    budget = _budget_amount(configured_budget)
    if require_positive and Decimal(budget) <= 0:
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
