"""Agent-auth budget reconciliation concern."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from datetime import timedelta
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    AGENT_GATEWAY_BUDGET_DURATION_V1,
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    AgentGatewayBudgetSubjectRecord,
)
from proliferate.integrations.bifrost import (
    BifrostIntegrationError,
)
from proliferate.server.cloud.agent_auth.deployment_plans import (
    _gateway_deployments_for_credential,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.managed_credit_rules import (
    _managed_credit_agent_kinds,
    _managed_credit_provider_kind_for_agent,
    _organization_managed_credit_entitlement_budget,
    _user_free_credit_entitlement_budget,
    _user_free_credit_period_key,
)
from proliferate.server.cloud.agent_auth.models import (
    GatewayModelDeploymentRequest,
)
from proliferate.server.cloud.agent_auth.provider_keys import (
    _ensure_bifrost_provider_key_for_managed_budget,
)
from proliferate.server.cloud.agent_auth.registry import (
    credential_provider_id_for_provider_kind,
)
from proliferate.server.cloud.agent_auth.value_redaction import (
    _budget_amount,
    _safe_error_message,
)

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

    managed_provider_plans: list[tuple[str, tuple[GatewayModelDeploymentRequest, ...]]] = []
    seen_credential_provider_ids: set[str] = set()
    for agent_kind in _managed_credit_agent_kinds():
        provider_kind = _managed_credit_provider_kind_for_agent(agent_kind)
        credential_provider_id = credential_provider_id_for_provider_kind(provider_kind)
        if credential_provider_id in seen_credential_provider_ids:
            continue
        deployments = _gateway_deployments_for_credential(
            credential_provider_id=credential_provider_id,
            provider_kind=provider_kind,
        )
        if deployments:
            managed_provider_plans.append((provider_kind, deployments))
            seen_credential_provider_ids.add(credential_provider_id)
    if not managed_provider_plans:
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
            materializations = [
                await _ensure_bifrost_provider_key_for_managed_budget(
                    db,
                    budget=budget,
                    deployments=deployments,
                    provider_kind=provider_kind,
                )
                for provider_kind, deployments in managed_provider_plans
            ]
            router_object_id = materializations[0].router_object_id if materializations else None
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
            fingerprint = _managed_budget_provider_keys_fingerprint(materializations)
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


def _managed_budget_provider_keys_fingerprint(
    materializations: Sequence[store.AgentGatewayRouterMaterializationRecord],
) -> str | None:
    if not materializations:
        return None
    payload = [
        {
            "routerObjectId": materialization.router_object_id,
            "syncFingerprint": materialization.sync_fingerprint,
        }
        for materialization in sorted(
            materializations,
            key=lambda item: item.router_object_id or "",
        )
    ]
    encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


async def _reconcile_managed_budget_subject(
    db: AsyncSession,
    *,
    budget: AgentGatewayBudgetSubjectRecord,
) -> AgentGatewayBudgetSubjectRecord:
    return await _reconcile_bifrost_managed_budget_subject(db, budget=budget)
