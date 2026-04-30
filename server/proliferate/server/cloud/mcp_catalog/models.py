from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from proliferate.server.cloud.mcp_catalog.catalog import (
    CATALOG_VERSION,
    ArgTemplate,
    CatalogEntry,
    CatalogSecretField,
    CatalogSettingField,
    CatalogSettingOption,
    EnvTemplate,
)


class ConnectorCatalogFieldModel(BaseModel):
    id: str
    label: str
    placeholder: str
    helper_text: str = Field(serialization_alias="helperText")
    get_token_instructions: str = Field(serialization_alias="getTokenInstructions")
    prefix_hint: str | None = Field(default=None, serialization_alias="prefixHint")


class ConnectorHttpAuthStyleModel(BaseModel):
    kind: Literal["bearer", "header", "query"]
    header_name: str | None = Field(default=None, serialization_alias="headerName")
    parameter_name: str | None = Field(default=None, serialization_alias="parameterName")


class ConnectorArgTemplateModel(BaseModel):
    source: dict[str, str]


class ConnectorEnvTemplateModel(BaseModel):
    name: str
    source: dict[str, str]


class ConnectorSettingsOptionModel(BaseModel):
    value: str
    label: str


class ConnectorSettingsFieldModel(BaseModel):
    id: str
    kind: Literal["string", "boolean", "select", "url"]
    label: str
    placeholder: str = ""
    helper_text: str = Field(default="", serialization_alias="helperText")
    required: bool
    default_value: str | bool | None = Field(default=None, serialization_alias="defaultValue")
    options: list[ConnectorSettingsOptionModel] = Field(default_factory=list)
    affects_url: bool = Field(serialization_alias="affectsUrl")


class ConnectorCatalogEntryModel(BaseModel):
    id: str
    version: int
    name: str
    one_liner: str = Field(serialization_alias="oneLiner")
    description: str
    docs_url: str = Field(serialization_alias="docsUrl")
    availability: Literal["universal", "local_only", "cloud_only"]
    cloud_secret_sync: bool = Field(serialization_alias="cloudSecretSync")
    transport: Literal["http", "stdio"]
    auth_kind: Literal["secret", "oauth", "none"] = Field(serialization_alias="authKind")
    auth_style: ConnectorHttpAuthStyleModel | None = Field(
        default=None,
        serialization_alias="authStyle",
    )
    auth_field_id: str | None = Field(default=None, serialization_alias="authFieldId")
    url: str
    display_url: str = Field(serialization_alias="displayUrl")
    command: str | None = None
    args: list[ConnectorArgTemplateModel] = Field(default_factory=list)
    env: list[ConnectorEnvTemplateModel] = Field(default_factory=list)
    server_name_base: str = Field(serialization_alias="serverNameBase")
    icon_id: str = Field(serialization_alias="iconId")
    secret_fields: list[ConnectorCatalogFieldModel] = Field(serialization_alias="secretFields")
    required_fields: list[ConnectorCatalogFieldModel] = Field(serialization_alias="requiredFields")
    settings_schema: list[ConnectorSettingsFieldModel] = Field(
        default_factory=list,
        serialization_alias="settingsSchema",
    )
    capabilities: list[str]


class ConnectorCatalogResponse(BaseModel):
    catalog_version: str = Field(serialization_alias="catalogVersion")
    entries: list[ConnectorCatalogEntryModel]


def _field_model(field: CatalogSecretField) -> ConnectorCatalogFieldModel:
    return ConnectorCatalogFieldModel(
        id=field.id,
        label=field.label,
        placeholder=field.placeholder,
        helper_text=field.helper_text,
        get_token_instructions=field.get_token_instructions,
        prefix_hint=field.prefix_hint,
    )


def _auth_style_model(entry: CatalogEntry) -> ConnectorHttpAuthStyleModel | None:
    """Best-effort compatibility for old desktop clients.

    New clients should use secretFields plus the server-side launch template.
    """
    if entry.auth_kind != "secret" or len(entry.secret_fields) != 1 or entry.http is None:
        return None
    secret_id = entry.secret_fields[0].id
    for header in entry.http.headers:
        if header.value == f"Bearer {{secret.{secret_id}}}" and header.name == "Authorization":
            return ConnectorHttpAuthStyleModel(kind="bearer")
        if header.value == f"{{secret.{secret_id}}}":
            return ConnectorHttpAuthStyleModel(kind="header", header_name=header.name)
    for query in entry.http.query:
        if query.value == f"{{secret.{secret_id}}}":
            return ConnectorHttpAuthStyleModel(kind="query", parameter_name=query.name)
    return None


def _arg_model(template: ArgTemplate) -> ConnectorArgTemplateModel:
    if template.kind == "static":
        return ConnectorArgTemplateModel(source={"kind": "static", "value": template.value or ""})
    return ConnectorArgTemplateModel(source={"kind": "workspace_path"})


def _env_model(template: EnvTemplate) -> ConnectorEnvTemplateModel:
    if template.kind == "static":
        return ConnectorEnvTemplateModel(
            name=template.name,
            source={"kind": "static", "value": template.value or ""},
        )
    return ConnectorEnvTemplateModel(
        name=template.name,
        source={"kind": "field", "fieldId": template.field_id or ""},
    )


def _settings_option_model(option: CatalogSettingOption) -> ConnectorSettingsOptionModel:
    return ConnectorSettingsOptionModel(value=option.value, label=option.label)


def _settings_field_model(field: CatalogSettingField) -> ConnectorSettingsFieldModel:
    return ConnectorSettingsFieldModel(
        id=field.id,
        kind=field.kind,
        label=field.label,
        placeholder=field.placeholder,
        helper_text=field.helper_text,
        required=field.required,
        default_value=field.default_value,
        options=[_settings_option_model(option) for option in field.options],
        affects_url=field.affects_url,
    )


def _settings_schema(entry: CatalogEntry) -> list[ConnectorSettingsFieldModel]:
    return [_settings_field_model(field) for field in entry.settings_fields]


def catalog_entry_payload(entry: CatalogEntry) -> ConnectorCatalogEntryModel:
    return ConnectorCatalogEntryModel(
        id=entry.id,
        version=entry.version,
        name=entry.name,
        one_liner=entry.one_liner,
        description=entry.description,
        docs_url=entry.docs_url,
        availability=entry.availability,
        cloud_secret_sync=entry.cloud_secret_sync,
        transport=entry.transport,
        auth_kind=entry.auth_kind,
        auth_style=_auth_style_model(entry),
        auth_field_id=entry.secret_fields[0].id if len(entry.secret_fields) == 1 else None,
        url=entry.display_url,
        display_url=entry.display_url,
        command=entry.command or None,
        args=[_arg_model(template) for template in entry.args],
        env=[_env_model(template) for template in entry.env],
        server_name_base=entry.server_name_base,
        icon_id=entry.icon_id,
        secret_fields=[_field_model(field) for field in entry.secret_fields],
        required_fields=[_field_model(field) for field in entry.secret_fields],
        settings_schema=_settings_schema(entry),
        capabilities=list(entry.capabilities),
    )


def catalog_response(entries: list[CatalogEntry]) -> ConnectorCatalogResponse:
    return ConnectorCatalogResponse(
        catalog_version=CATALOG_VERSION,
        entries=[catalog_entry_payload(entry) for entry in entries],
    )
