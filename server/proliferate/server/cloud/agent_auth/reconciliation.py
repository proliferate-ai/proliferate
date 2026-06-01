"""Agent-auth reconciliation concern."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth import store
from proliferate.server.cloud.agent_auth.budget_reconciliation import (
    _reconcile_managed_budget_subject,
)
from proliferate.server.cloud.agent_auth.gateway_policies import _reconcile_gateway_policy
from proliferate.server.cloud.agent_auth.results import AgentGatewayReconcilePassResult
from proliferate.server.cloud.agent_auth.usage_import import import_bifrost_usage_logs

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
