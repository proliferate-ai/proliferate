"""Cloud capability projection."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from proliferate.config import settings
from proliferate.server.cloud.agent_auth.domain.byok_policy import gateway_route_isolation_ready
from proliferate.server.cloud.capabilities.models import (
    AgentGatewayByokProviderCapabilities,
    AgentGatewayCapabilities,
    CloudCapabilitiesResponse,
)


def cloud_capabilities() -> CloudCapabilitiesResponse:
    gateway_enabled = bool(settings.agent_gateway_enabled)
    managed_budgets = (
        settings.agent_gateway_managed_budget_free_usd.strip(),
        settings.agent_gateway_managed_budget_pro_usd.strip(),
        settings.agent_gateway_managed_budget_unlimited_usd.strip(),
    )
    default_managed_budget = next(
        (budget for budget in managed_budgets if _positive_decimal_string(budget)),
        None,
    )
    personal_managed_budget = settings.agent_gateway_user_free_credit_usd.strip()
    managed_credits_personal_enabled = (
        gateway_enabled
        and settings.agent_gateway_user_free_credit_enabled
        and _positive_decimal_string(personal_managed_budget)
    )
    managed_credits_organization_enabled = gateway_enabled and default_managed_budget is not None
    topology = "bifrost"
    route_isolation = "bifrost_virtual_key"
    live_proof_status = (
        "passed" if settings.agent_gateway_bifrost_isolation_verified else "not_run"
    )
    route_isolation_ready = gateway_route_isolation_ready(
        bifrost_isolation_verified=settings.agent_gateway_bifrost_isolation_verified,
    )
    org_byok_enabled = (
        gateway_enabled and settings.agent_gateway_byok_enabled and route_isolation_ready
    )
    personal_byok_enabled = (
        gateway_enabled
        and settings.agent_gateway_byok_enabled
        and settings.agent_gateway_personal_byok_enabled
        and route_isolation_ready
    )
    return CloudCapabilitiesResponse(
        agentGateway=AgentGatewayCapabilities(
            enabled=gateway_enabled,
            managedCreditsPersonalEnabled=managed_credits_personal_enabled,
            managedCreditsOrganizationEnabled=managed_credits_organization_enabled,
            defaultManagedBudgetUsd=default_managed_budget,
            managedCreditAgentKinds=_managed_credit_agent_kinds(),
            topology=topology,
            routeIsolation=route_isolation,
            liveProofStatus=live_proof_status,
            byokEnabled=gateway_enabled and settings.agent_gateway_byok_enabled,
            byokPersonalEnabled=personal_byok_enabled,
            byokOrganizationEnabled=org_byok_enabled,
            byokOrganizationDisabledReason=(
                None if org_byok_enabled else "gateway_byok_route_isolation_unverified"
            ),
            byokProviders=AgentGatewayByokProviderCapabilities(
                anthropicApiKey=(
                    gateway_enabled
                    and settings.agent_gateway_byok_enabled
                    and settings.agent_gateway_anthropic_byok_enabled
                ),
                openaiApiKey=(
                    gateway_enabled
                    and settings.agent_gateway_byok_enabled
                    and settings.agent_gateway_openai_byok_enabled
                ),
                geminiApiKey=(
                    gateway_enabled
                    and settings.agent_gateway_byok_enabled
                    and settings.agent_gateway_gemini_byok_enabled
                ),
                bedrockAssumeRole=(
                    gateway_enabled
                    and settings.agent_gateway_byok_enabled
                    and settings.agent_gateway_bedrock_byok_enabled
                ),
                openaiCompatible=False,
            ),
            opencodeGatewayEnabled=gateway_enabled and settings.agent_gateway_opencode_enabled,
        )
    )


def _positive_decimal_string(value: str) -> bool:
    try:
        parsed = Decimal(value)
        return parsed.is_finite() and parsed > 0
    except (InvalidOperation, ValueError):
        return False


def _managed_credit_agent_kinds() -> list[str]:
    configured = [
        item.strip()
        for item in settings.agent_gateway_managed_credit_agent_kinds.split(",")
        if item.strip()
    ]
    agent_kinds = [
        item for item in configured if item in {"claude", "codex", "opencode", "gemini"}
    ]
    return agent_kinds or ["claude"]
