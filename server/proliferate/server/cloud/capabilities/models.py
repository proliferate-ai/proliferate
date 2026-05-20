"""Cloud capability response models."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AgentGatewayCapabilities(BaseModel):
    enabled: bool
    byok_enabled: bool = Field(alias="byokEnabled")
    anthropic_byok_enabled: bool = Field(alias="anthropicByokEnabled")
    openai_byok_enabled: bool = Field(alias="openaiByokEnabled")
    bedrock_byok_enabled: bool = Field(alias="bedrockByokEnabled")
    openai_compatible_byok_enabled: bool = Field(alias="openaiCompatibleByokEnabled")
    opencode_enabled: bool = Field(alias="opencodeEnabled")


class CloudCapabilitiesResponse(BaseModel):
    agent_gateway: AgentGatewayCapabilities = Field(alias="agentGateway")
