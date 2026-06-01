"""Agent-auth deployment plans concern."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from datetime import timedelta
from uuid import UUID

from proliferate.config import settings
from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.server.cloud.agent_auth.domain.desired_state import (
    GatewayModelDeploymentPlan,
    fingerprint_gateway_policy_state,
)
from proliferate.server.cloud.agent_auth.models import (
    GatewayModelDeploymentRequest,
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


def _gateway_deployments_for_credential(
    *,
    agent_kind: str,
    provider_kind: str,
) -> tuple[GatewayModelDeploymentRequest, ...]:
    if provider_kind in {
        "proliferate_bedrock_pool",
        "proliferate_managed_anthropic",
        "proliferate_managed_openai",
        "proliferate_managed_gemini",
    }:
        return _bifrost_deployments_for_managed_credits(
            agent_kind=agent_kind,
            provider_kind=provider_kind,
        )
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


def _bifrost_deployments_for_managed_credits(
    *,
    agent_kind: str,
    provider_kind: str,
) -> tuple[GatewayModelDeploymentRequest, ...]:
    if agent_kind == "claude":
        if provider_kind == "proliferate_bedrock_pool":
            return (
                GatewayModelDeploymentRequest(
                    publicModelName="us.anthropic.claude-sonnet-4-6",
                    providerModel="us.anthropic.claude-sonnet-4-6",
                ),
            )
        if provider_kind == "proliferate_managed_anthropic":
            return (
                GatewayModelDeploymentRequest(
                    publicModelName="claude-sonnet-4-6",
                    providerModel="claude-sonnet-4-6",
                ),
            )
    if agent_kind == "codex" and provider_kind == "proliferate_managed_openai":
        return (
            GatewayModelDeploymentRequest(
                publicModelName="gpt-5.5",
                providerModel="gpt-5.5",
            ),
        )
    if agent_kind == "opencode" and provider_kind == "proliferate_managed_openai":
        return (
            GatewayModelDeploymentRequest(
                publicModelName="opencode/big-pickle",
                providerModel="gpt-5.5",
            ),
        )
    if agent_kind == "gemini" and provider_kind == "proliferate_managed_gemini":
        return (
            GatewayModelDeploymentRequest(
                publicModelName="gemini-2.5-pro",
                providerModel="gemini-2.5-pro",
            ),
        )
    return ()


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
