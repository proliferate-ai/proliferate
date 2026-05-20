"""Cloud capability projection."""

from __future__ import annotations

from proliferate.config import settings
from proliferate.server.cloud.capabilities.models import (
    AgentGatewayCapabilities,
    CloudCapabilitiesResponse,
)


def cloud_capabilities() -> CloudCapabilitiesResponse:
    gateway_enabled = bool(settings.agent_gateway_enabled)
    return CloudCapabilitiesResponse(
        agentGateway=AgentGatewayCapabilities(
            enabled=gateway_enabled,
            byokEnabled=gateway_enabled and settings.agent_gateway_byok_enabled,
            anthropicByokEnabled=(
                gateway_enabled
                and settings.agent_gateway_byok_enabled
                and settings.agent_gateway_anthropic_byok_enabled
            ),
            openaiByokEnabled=(
                gateway_enabled
                and settings.agent_gateway_byok_enabled
                and settings.agent_gateway_openai_byok_enabled
            ),
            bedrockByokEnabled=(
                gateway_enabled
                and settings.agent_gateway_byok_enabled
                and settings.agent_gateway_bedrock_byok_enabled
            ),
            openaiCompatibleByokEnabled=(
                gateway_enabled
                and settings.agent_gateway_byok_enabled
                and settings.agent_gateway_openai_compatible_byok_enabled
            ),
            opencodeEnabled=gateway_enabled and settings.agent_gateway_opencode_enabled,
        )
    )
