"""Cloud capability projection."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from proliferate.config import settings
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
    managed_credits_enabled = gateway_enabled and default_managed_budget is not None
    return CloudCapabilitiesResponse(
        agentGateway=AgentGatewayCapabilities(
            enabled=gateway_enabled,
            managedCreditsPersonalEnabled=managed_credits_enabled,
            managedCreditsOrganizationEnabled=managed_credits_enabled,
            defaultManagedBudgetUsd=default_managed_budget,
            byokEnabled=gateway_enabled and settings.agent_gateway_byok_enabled,
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
                bedrockAssumeRole=(
                    gateway_enabled
                    and settings.agent_gateway_byok_enabled
                    and settings.agent_gateway_bedrock_byok_enabled
                ),
                openaiCompatible=(
                    gateway_enabled
                    and settings.agent_gateway_byok_enabled
                    and settings.agent_gateway_openai_compatible_byok_enabled
                ),
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
