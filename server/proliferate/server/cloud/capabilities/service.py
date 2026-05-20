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
    default_managed_budget = settings.agent_gateway_default_managed_budget_usd.strip()
    managed_credits_enabled = gateway_enabled and _positive_decimal_string(default_managed_budget)
    return CloudCapabilitiesResponse(
        agentGateway=AgentGatewayCapabilities(
            enabled=gateway_enabled,
            managedCreditsPersonalEnabled=managed_credits_enabled,
            managedCreditsOrganizationEnabled=managed_credits_enabled,
            defaultManagedBudgetUsd=(
                default_managed_budget if managed_credits_enabled else None
            ),
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
