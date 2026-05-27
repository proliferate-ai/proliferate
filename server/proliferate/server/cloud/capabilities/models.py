"""Cloud capability response models."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AgentGatewayByokProviderCapabilities(BaseModel):
    anthropic_api_key: bool = Field(alias="anthropicApiKey")
    openai_api_key: bool = Field(alias="openaiApiKey")
    gemini_api_key: bool = Field(alias="geminiApiKey")
    bedrock_assume_role: bool = Field(alias="bedrockAssumeRole")
    openai_compatible: bool = Field(alias="openaiCompatible")


class AgentGatewayCapabilities(BaseModel):
    enabled: bool
    managed_credits_personal_enabled: bool = Field(alias="managedCreditsPersonalEnabled")
    managed_credits_organization_enabled: bool = Field(alias="managedCreditsOrganizationEnabled")
    default_managed_budget_usd: str | None = Field(alias="defaultManagedBudgetUsd")
    managed_credit_agent_kinds: list[str] = Field(alias="managedCreditAgentKinds")
    topology: str
    route_isolation: str = Field(alias="routeIsolation")
    live_proof_status: str = Field(alias="liveProofStatus")
    byok_enabled: bool = Field(alias="byokEnabled")
    byok_personal_enabled: bool = Field(alias="byokPersonalEnabled")
    byok_organization_enabled: bool = Field(alias="byokOrganizationEnabled")
    byok_organization_disabled_reason: str | None = Field(alias="byokOrganizationDisabledReason")
    byok_providers: AgentGatewayByokProviderCapabilities = Field(alias="byokProviders")
    opencode_gateway_enabled: bool = Field(alias="opencodeGatewayEnabled")


class CloudCapabilitiesResponse(BaseModel):
    agent_gateway: AgentGatewayCapabilities = Field(alias="agentGateway")
