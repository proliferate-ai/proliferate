"""Agent-auth gateway policies concern."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialRecord,
    AgentGatewayBudgetSubjectRecord,
    AgentGatewayPolicyRecord,
)
from proliferate.integrations.bifrost import (
    BifrostIntegrationError,
)
from proliferate.server.cloud.agent_auth.budget_reconciliation import (
    _reconcile_managed_budget_subject,
)
from proliferate.server.cloud.agent_auth.byok_gates import _gateway_byok_launch_verdict
from proliferate.server.cloud.agent_auth.deployment_plans import (
    _deployment_fingerprint,
    _gateway_deployments_for_credential,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.models import (
    GatewayModelDeploymentRequest,
)
from proliferate.server.cloud.agent_auth.provider_keys import (
    _ensure_bifrost_policy_provider_key,
)
from proliferate.server.cloud.agent_auth.value_redaction import _safe_error_message
from proliferate.utils.crypto import decrypt_json

_ORG_ADMIN_ROLES = {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}
_GATEWAY_GRANT_TTL = timedelta(days=7)
_DEFAULT_MANAGED_CREDIT_AGENT_KINDS: tuple[CloudAgentKind, ...] = ("claude",)
_USER_FREE_CREDIT_SOURCE = "signup_free_credit"
_CLEANUP_SELECTION_ERROR_CODES = {
    "credential_revoked",
    "credential_share_revoked",
}
_MANAGED_CODEX_HOME = "/home/user/.proliferate/anyharness/agent-auth/codex"
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
            credential_provider_id=credential.credential_provider_id,
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
