"""Cloud capability response models."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AgentGatewayByokProviderCapabilities(BaseModel):
    anthropic_api_key: bool = Field(alias="anthropicApiKey")
    openai_api_key: bool = Field(alias="openaiApiKey")
    bedrock_assume_role: bool = Field(alias="bedrockAssumeRole")
    openai_compatible: bool = Field(alias="openaiCompatible")


class AgentGatewayCapabilities(BaseModel):
    enabled: bool
    managed_credits_personal_enabled: bool = Field(alias="managedCreditsPersonalEnabled")
    managed_credits_organization_enabled: bool = Field(alias="managedCreditsOrganizationEnabled")
    default_managed_budget_usd: str | None = Field(alias="defaultManagedBudgetUsd")
    byok_enabled: bool = Field(alias="byokEnabled")
    byok_providers: AgentGatewayByokProviderCapabilities = Field(alias="byokProviders")
    opencode_gateway_enabled: bool = Field(alias="opencodeGatewayEnabled")


class CloudCapabilitiesResponse(BaseModel):
    agent_gateway: AgentGatewayCapabilities = Field(alias="agentGateway")
