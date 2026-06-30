from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class IntegrationApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class IntegrationAuthModeModel(IntegrationApiModel):
    kind: Literal["oauth2", "api_key", "none"]
    client_strategy: Literal["dcr", "client_metadata_document", "static"] | None = Field(
        default=None,
        alias="clientStrategy",
    )
    label: str | None = None


class IntegrationSettingOptionModel(IntegrationApiModel):
    value: str
    label: str


class IntegrationSettingModel(IntegrationApiModel):
    id: str
    label: str
    default: str
    options: list[IntegrationSettingOptionModel]


class IntegrationDefinitionResponse(IntegrationApiModel):
    id: str
    key: str
    source: Literal["seed", "org_custom"]
    organization_id: str | None = Field(default=None, alias="organizationId")
    display_name: str = Field(alias="displayName")
    namespace: str
    provider_group: str | None = Field(default=None, alias="providerGroup")
    transport: Literal["http"]
    implementation: Literal["upstream_mcp", "virtual_proliferate_mcp"]
    enabled_by_default: bool = Field(alias="enabledByDefault")
    auth_modes: list[IntegrationAuthModeModel] = Field(alias="authModes")
    settings: list[IntegrationSettingModel]
    flags: dict[str, object]
    icon_id: str | None = Field(default=None, alias="iconId")
    tool_surface_kind: str = Field(alias="toolSurfaceKind")
    archived_at: datetime | None = Field(default=None, alias="archivedAt")


class CreateIntegrationDefinitionRequest(IntegrationApiModel):
    organization_id: str = Field(alias="organizationId")
    display_name: str = Field(alias="displayName")
    namespace: str
    mcp_url: str = Field(alias="mcpUrl")


class CreateIntegrationAccountRequest(IntegrationApiModel):
    definition_id: str = Field(alias="definitionId")
    auth_kind: Literal["oauth2", "api_key", "none"] = Field(alias="authKind")
    api_key: str | None = Field(default=None, alias="apiKey")
    settings: dict[str, object] | None = None


class PatchIntegrationAccountRequest(IntegrationApiModel):
    enabled: bool | None = None
    api_key: str | None = Field(default=None, alias="apiKey")
    settings: dict[str, object] | None = None


class IntegrationAccountResponse(IntegrationApiModel):
    id: str
    definition_id: str = Field(alias="definitionId")
    owner_scope: Literal["personal", "organization"] = Field(alias="ownerScope")
    owner_user_id: str | None = Field(default=None, alias="ownerUserId")
    organization_id: str | None = Field(default=None, alias="organizationId")
    auth_kind: Literal["oauth2", "api_key", "none"] = Field(alias="authKind")
    status: Literal["ready", "setup_required", "reauth_required", "error", "disabled"]
    settings: dict[str, object]
    auth_version: int = Field(alias="authVersion")
    token_expires_at: datetime | None = Field(default=None, alias="tokenExpiresAt")
    last_error_code: str | None = Field(default=None, alias="lastErrorCode")
    enabled: bool
    definition: IntegrationDefinitionResponse


class StartIntegrationOAuthFlowRequest(IntegrationApiModel):
    callback_surface: Literal["desktop", "web"] | None = Field(
        default=None, alias="callbackSurface"
    )
    final_surface: Literal["desktop", "web"] | None = Field(default=None, alias="finalSurface")
    return_path: str | None = Field(default=None, alias="returnPath")
    client_strategy: Literal["dcr", "client_metadata_document", "static"] | None = Field(
        default=None,
        alias="clientStrategy",
    )


class StartIntegrationOAuthFlowResponse(IntegrationApiModel):
    flow_id: str = Field(alias="flowId")
    status: str
    authorization_url: str = Field(alias="authorizationUrl")
    expires_at: datetime = Field(alias="expiresAt")


class IntegrationOAuthFlowStatusResponse(IntegrationApiModel):
    flow_id: str = Field(alias="flowId")
    status: str
    authorization_url: str | None = Field(default=None, alias="authorizationUrl")
    failure_code: str | None = Field(default=None, alias="failureCode")
    expires_at: datetime = Field(alias="expiresAt")
    callback_surface: str = Field(alias="callbackSurface")
    final_surface: str = Field(alias="finalSurface")


class IntegrationAvailabilityItem(IntegrationApiModel):
    definition_id: str = Field(alias="definitionId")
    account_id: str | None = Field(default=None, alias="accountId")
    namespace: str
    display_name: str = Field(alias="displayName")
    icon_id: str | None = Field(default=None, alias="iconId")
    status: Literal[
        "ready",
        "setup_required",
        "reauth_required",
        "refreshing",
        "disabled",
        "unavailable",
    ]
    auth_modes: list[Literal["oauth2", "api_key", "none"]] = Field(alias="authModes")
    selected_auth_kind: Literal["oauth2", "api_key", "none"] | None = Field(
        default=None,
        alias="selectedAuthKind",
    )
    tool_count: int | None = Field(default=None, alias="toolCount")
    reconnect_url: str | None = Field(default=None, alias="reconnectUrl")
    last_error_code: str | None = Field(default=None, alias="lastErrorCode")


class IntegrationToolMetadataTool(IntegrationApiModel):
    gateway_tool_name: str = Field(alias="gatewayToolName")
    upstream_tool_name: str = Field(alias="upstreamToolName")
    display_name: str = Field(alias="displayName")


class IntegrationToolMetadata(IntegrationApiModel):
    namespace: str
    display_name: str = Field(alias="displayName")
    icon_id: str | None = Field(default=None, alias="iconId")
    tools: list[IntegrationToolMetadataTool]


class IntegrationClientMetadataDocument(IntegrationApiModel):
    client_name: str = Field(alias="client_name")
    application_type: str = Field(alias="application_type")
    redirect_uris: list[str] = Field(alias="redirect_uris")
    grant_types: list[str] = Field(alias="grant_types")
    response_types: list[str] = Field(alias="response_types")
    token_endpoint_auth_method: str = Field(alias="token_endpoint_auth_method")
