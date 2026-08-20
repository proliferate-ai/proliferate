"""Request/response models for the integration management API.

camelCase on the wire (``alias_generator=to_camel``); accept snake_case too
(``populate_by_name=True``), mirroring the runtime_workers models.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from typing_extensions import TypedDict

AuthKind = Literal["oauth2", "api_key", "none"]
Surface = Literal["desktop", "web"]

# How the auth kind of an org-custom definition was determined at creation:
# probe found an OAuth challenge ("detected"), probe found none ("none"),
# probe timed out ("unreachable"), or the admin chose explicitly ("forced").
AuthDetection = Literal["detected", "none", "unreachable", "forced"]


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --------------------------------------------------------------------------- #
# User-facing authentication
# --------------------------------------------------------------------------- #


class AuthenticateIntegrationRequest(_CamelModel):
    definition_id: UUID
    auth_kind: AuthKind
    api_key: str | None = None
    settings: dict[str, Any] | None = None
    callback_surface: Surface | None = None
    final_surface: Surface | None = None
    return_path: str | None = None


class IntegrationAccountResponse(_CamelModel):
    account_id: UUID
    definition_id: UUID
    namespace: str
    display_name: str
    auth_kind: str
    status: str
    enabled: bool


class AuthenticateIntegrationResponse(_CamelModel):
    account: IntegrationAccountResponse | None = None
    attempt_id: UUID | None = None
    attempt_generation: int | None = None
    oauth_flow_id: str | None = None
    authorization_url: str | None = None
    expires_at: datetime | None = None


class IntegrationOAuthFlowStatusResponse(_CamelModel):
    flow_id: UUID
    status: str
    authorization_url: str | None = None
    expires_at: datetime
    failure_code: str | None = None
    callback_surface: str
    final_surface: str


# --------------------------------------------------------------------------- #
# Connect catalog
# --------------------------------------------------------------------------- #


class IntegrationCatalogSecretField(_CamelModel):
    id: str
    label: str
    placeholder: str | None = None
    helper_text: str | None = None
    prefix_hint: str | None = None


class IntegrationCatalogSettingOption(_CamelModel):
    value: str
    label: str


class IntegrationCatalogSettingField(_CamelModel):
    id: str
    label: str
    kind: str
    required: bool = False
    options: list[IntegrationCatalogSettingOption] = []
    default: str | bool | None = None


class IntegrationConnectSchema(_CamelModel):
    secret_fields: list[IntegrationCatalogSecretField] = []
    settings_fields: list[IntegrationCatalogSettingField] = []


class IntegrationCatalogItem(_CamelModel):
    definition_id: UUID
    namespace: str
    display_name: str
    description: str | None = None
    auth_kind: str
    connect_schema: IntegrationConnectSchema


class IntegrationCatalogResponse(_CamelModel):
    items: list[IntegrationCatalogItem]


class IntegrationHealthItem(_CamelModel):
    definition_id: UUID
    account_id: UUID | None = None
    namespace: str
    display_name: str
    auth_kind: str
    effective_enabled: bool
    policy_enabled: bool | None = None
    account_enabled: bool | None = None
    health: str
    token_expires_at: datetime | None = None
    tool_count: int | None = None
    last_error_code: str | None = None


class IntegrationHealthResponse(_CamelModel):
    items: list[IntegrationHealthItem]


# --------------------------------------------------------------------------- #
# Authoritative management projection (route and assembler land in PR2)
# --------------------------------------------------------------------------- #


IntegrationPrimaryAction = Literal["connect", "reconnect", "open_authorization", "none"]
IntegrationSecondaryAction = Literal["cancel", "disconnect"]
IntegrationAttemptPurpose = Literal["connect", "reauthorize", "rotate"]
IntegrationAttemptStatus = Literal[
    "active",
    "exchanging",
    "validating",
    "succeeded",
    "failed",
    "cancelled",
    "expired",
    "superseded",
]


class IntegrationProviderAvailability(TypedDict):
    available: bool
    reason: str | None


class IntegrationConnectionSummary(TypedDict):
    accountId: UUID
    status: str
    enabled: bool
    health: str
    toolCount: int | None
    tokenExpiresAt: datetime | None
    lastErrorCode: str | None


class IntegrationAuthorizationAttemptSummary(TypedDict):
    attemptId: UUID
    purpose: IntegrationAttemptPurpose
    method: AuthKind
    generation: int
    status: IntegrationAttemptStatus
    authorizationUrl: str | None
    expiresAt: datetime
    failureCode: str | None


class IntegrationManagementActions(TypedDict):
    primary: IntegrationPrimaryAction
    secondary: list[IntegrationSecondaryAction]


class IntegrationManagementItem(TypedDict):
    definitionId: UUID
    namespace: str
    displayName: str
    description: str | None
    authKind: str
    connectSchema: IntegrationConnectSchema
    availability: IntegrationProviderAvailability
    connection: IntegrationConnectionSummary | None
    attempt: IntegrationAuthorizationAttemptSummary | None
    actions: IntegrationManagementActions


class IntegrationManagementResponse(TypedDict):
    items: list[IntegrationManagementItem]


class CancelIntegrationAuthorizationAttemptResponse(TypedDict):
    attempt: IntegrationAuthorizationAttemptSummary


# --------------------------------------------------------------------------- #
# Org-admin definition management
# --------------------------------------------------------------------------- #


class AdminIntegrationDefinitionResponse(_CamelModel):
    definition_id: UUID
    namespace: str
    display_name: str
    source: str
    organization_id: UUID | None = None
    auth_kind: str
    enabled_by_default: bool
    policy_enabled: bool | None = None
    effective_enabled: bool
    auth_detection: AuthDetection | None = None


class CreateAdminIntegrationDefinitionRequest(_CamelModel):
    display_name: str
    namespace: str
    mcp_url: str
    auth_kind: Literal["auto", "none", "oauth2"] = "auto"


class SetIntegrationEnabledRequest(_CamelModel):
    enabled: bool
