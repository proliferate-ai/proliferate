"""Agent-auth byok gates concern."""

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
from proliferate.db.store.cloud_agent_auth.records import (
    AgentGatewayPolicyRecord,
)
from proliferate.server.cloud.agent_auth.domain.byok_policy import (
    GatewayByokVerdict,
    gateway_byok_policy_verdict,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError

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
