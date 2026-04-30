from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ConnectorAvailability = Literal["universal", "local_only", "cloud_only"]
ConnectorTransport = Literal["http", "stdio"]
ConnectorAuthKind = Literal["secret", "oauth", "none"]
ConnectorOAuthClientMode = Literal["dcr", "static"]
ConnectorSettingKind = Literal["string", "boolean", "select", "url"]
LaunchUrlContext = Literal[
    "catalog",
    "local_materialization",
    "cloud_materialization",
    "oauth_resource",
]


class CatalogConfigurationError(ValueError):
    """Raised when a catalog entry cannot be validated or rendered."""


@dataclass(frozen=True)
class CatalogSecretField:
    id: str
    label: str
    placeholder: str
    helper_text: str
    get_token_instructions: str
    prefix_hint: str | None = None


@dataclass(frozen=True)
class CatalogSettingOption:
    value: str
    label: str


@dataclass(frozen=True)
class CatalogSettingField:
    id: str
    label: str
    kind: ConnectorSettingKind
    required: bool = False
    placeholder: str = ""
    helper_text: str = ""
    default_value: str | bool | None = None
    options: tuple[CatalogSettingOption, ...] = ()
    affects_url: bool = False


@dataclass(frozen=True)
class StaticUrl:
    value: str


@dataclass(frozen=True)
class UrlVariant:
    value: str
    url: str


@dataclass(frozen=True)
class UrlBySetting:
    setting_id: str
    variants: tuple[UrlVariant, ...]


@dataclass(frozen=True)
class HeaderTemplate:
    name: str
    value: str
    optional: bool = False


@dataclass(frozen=True)
class QueryTemplate:
    name: str
    value: str
    optional: bool = False


@dataclass(frozen=True)
class HttpLaunchTemplate:
    url: StaticUrl | UrlBySetting
    display_url: str
    headers: tuple[HeaderTemplate, ...] = ()
    query: tuple[QueryTemplate, ...] = ()


@dataclass(frozen=True)
class RenderedHeader:
    name: str
    value: str


@dataclass(frozen=True)
class RenderedHttpLaunch:
    url: str
    headers: tuple[RenderedHeader, ...]


@dataclass(frozen=True)
class ArgTemplate:
    kind: Literal["static", "workspace_path", "secret", "setting"]
    value: str | None = None
    field_id: str | None = None


@dataclass(frozen=True)
class EnvTemplate:
    name: str
    kind: Literal["static", "secret", "setting"]
    value: str | None = None
    field_id: str | None = None


@dataclass(frozen=True)
class CatalogEntry:
    id: str
    version: int
    name: str
    one_liner: str
    description: str
    docs_url: str
    availability: ConnectorAvailability
    transport: ConnectorTransport
    auth_kind: ConnectorAuthKind
    server_name_base: str
    icon_id: str
    capabilities: tuple[str, ...]
    oauth_client_mode: ConnectorOAuthClientMode | None = None
    cloud_secret_sync: bool = False
    secret_fields: tuple[CatalogSecretField, ...] = ()
    settings_fields: tuple[CatalogSettingField, ...] = ()
    http: HttpLaunchTemplate | None = None
    command: str = ""
    args: tuple[ArgTemplate, ...] = ()
    env: tuple[EnvTemplate, ...] = ()

    @property
    def display_url(self) -> str:
        return self.http.display_url if self.http is not None else ""
