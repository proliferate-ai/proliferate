"""Agent-auth managed credit rules concern."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import BILLING_PLAN_PRO
from proliferate.constants.cloud import (
    AGENT_GATEWAY_BUDGET_DURATION_V1,
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject
from proliferate.server.billing.snapshots import get_billing_snapshot_for_subject_in_session
from proliferate.server.cloud.agent_auth.deployment_plans import (
    _gateway_deployments_for_credential,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.models import (
    GatewayModelDeploymentRequest,
)
from proliferate.server.cloud.agent_auth.value_redaction import _budget_amount
from proliferate.utils.time import utcnow

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


def _managed_credit_agent_kinds() -> tuple[CloudAgentKind, ...]:
    configured = [
        item.strip()
        for item in settings.agent_gateway_managed_credit_agent_kinds.split(",")
        if item.strip()
    ]
    agent_kinds = tuple(
        item
        for item in configured
        if item in {"claude", "codex", "opencode", "gemini"}
        and _managed_credit_agent_kind_has_provider(item)
    )
    if agent_kinds:
        return agent_kinds
    if not configured:
        return tuple(
            item
            for item in _DEFAULT_MANAGED_CREDIT_AGENT_KINDS
            if _managed_credit_agent_kind_has_provider(item)
        )
    return ()


def _managed_credit_agent_kind_has_provider(agent_kind: str) -> bool:
    if agent_kind == "claude":
        return bool(
            (
                settings.agent_gateway_managed_bedrock_region.strip()
                and settings.agent_gateway_managed_bedrock_role_arn.strip()
            )
            or settings.agent_gateway_managed_anthropic_api_key.strip()
        )
    if agent_kind in {"codex", "opencode"}:
        return bool(settings.agent_gateway_managed_openai_api_key.strip())
    if agent_kind == "gemini":
        return bool(settings.agent_gateway_managed_gemini_api_key.strip())
    return False


def _managed_credit_provider_kind_for_agent(agent_kind: str) -> str:
    if agent_kind == "claude":
        if (
            settings.agent_gateway_managed_bedrock_region.strip()
            and settings.agent_gateway_managed_bedrock_role_arn.strip()
        ):
            return "proliferate_bedrock_pool"
        if settings.agent_gateway_managed_anthropic_api_key.strip():
            return "proliferate_managed_anthropic"
    elif agent_kind in {"codex", "opencode"}:
        if settings.agent_gateway_managed_openai_api_key.strip():
            return "proliferate_managed_openai"
    elif agent_kind == "gemini":
        if settings.agent_gateway_managed_gemini_api_key.strip():
            return "proliferate_managed_gemini"
    raise AgentAuthError(
        "No managed-credit provider is configured for this agent.",
        code="managed_credit_provider_not_configured",
        status_code=409,
    )


def _managed_credit_deployments_for_agent(
    agent_kind: str,
) -> tuple[str, tuple[GatewayModelDeploymentRequest, ...]]:
    provider_kind = _managed_credit_provider_kind_for_agent(agent_kind)
    deployments = _gateway_deployments_for_credential(
        agent_kind=agent_kind,
        provider_kind=provider_kind,
    )
    return provider_kind, deployments


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
