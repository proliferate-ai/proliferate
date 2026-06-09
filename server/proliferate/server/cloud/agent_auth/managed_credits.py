"""Agent-auth managed credits concern."""

from __future__ import annotations

import json
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db import session_ops as db_session
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialRecord,
    AgentGatewayBudgetSubjectRecord,
    AgentGatewayPolicyRecord,
)
from proliferate.server.cloud.agent_auth.access_control import _require_organization_admin
from proliferate.server.cloud.agent_auth.budget_reconciliation import (
    _reconcile_managed_budget_subject,
)
from proliferate.server.cloud.agent_auth.gateway_policies import _ensure_managed_policy
from proliferate.server.cloud.agent_auth.managed_credit_rules import (
    _managed_credit_agent_kinds,
    _managed_credit_deployments_for_agent,
    _organization_managed_credit_entitlement_budget,
)
from proliferate.server.cloud.agent_auth.models import (
    EnsureManagedCreditsRequest,
)
from proliferate.server.cloud.agent_auth.registry import (
    credential_provider_id_for_provider_kind,
)
from proliferate.server.cloud.agent_auth.results import EnsureManagedCreditsResult

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
        for deployment in _managed_credit_deployments_for_agent(agent_kind)[1]
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
    seen_credential_provider_ids: set[str] = set()
    for agent_kind in requested_agent_kinds:
        provider_kind, deployments = _managed_credit_deployments_for_agent(agent_kind)
        if not deployments:
            continue
        credential_provider_id = credential_provider_id_for_provider_kind(provider_kind)
        if credential_provider_id in seen_credential_provider_ids:
            continue
        seen_credential_provider_ids.add(credential_provider_id)
        credential = await store.get_managed_gateway_credential(
            db,
            organization_id=organization_id,
            credential_provider_id=credential_provider_id,
        )
        if credential is None:
            credential = await store.create_agent_auth_credential(
                db,
                owner_scope="organization",
                owner_user_id=None,
                organization_id=organization_id,
                created_by_user_id=actor_user_id,
                credential_provider_id=credential_provider_id,
                credential_kind="managed_gateway",
                display_name="Proliferate managed credits",
                redacted_summary_json=json.dumps(
                    {
                        "providerKind": provider_kind,
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


async def sync_managed_credit_budget_for_organization(
    organization_id: UUID,
) -> AgentGatewayBudgetSubjectRecord | None:
    """Recompute and mirror an existing managed-credit budget after billing changes."""

    async with db_session.open_async_session() as db:
        budget = await store.get_managed_budget_subject(db, organization_id)
        if budget is None:
            return None
        reconciled = await _reconcile_managed_budget_subject(db, budget=budget)
        await db_session.commit_session(db)
        return reconciled
