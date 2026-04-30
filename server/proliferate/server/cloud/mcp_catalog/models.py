from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from proliferate.server.cloud.mcp_catalog.catalog import (
    CATALOG_VERSION,
    ArgTemplate,
    CatalogEntry,
    CatalogField,
    EnvTemplate,
    HttpAuthStyle,
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


class ConnectorSettingsFieldModel(BaseModel):
    id: str
    kind: Literal["string", "boolean"]
    required: bool
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
    command: str | None = None
    args: list[ConnectorArgTemplateModel] = Field(default_factory=list)
    env: list[ConnectorEnvTemplateModel] = Field(default_factory=list)
    server_name_base: str = Field(serialization_alias="serverNameBase")
    icon_id: str = Field(serialization_alias="iconId")
    required_fields: list[ConnectorCatalogFieldModel] = Field(serialization_alias="requiredFields")
    settings_schema: list[ConnectorSettingsFieldModel] = Field(
        default_factory=list,
        serialization_alias="settingsSchema",
    )
    capabilities: list[str]


class ConnectorCatalogResponse(BaseModel):
    catalog_version: str = Field(serialization_alias="catalogVersion")
    entries: list[ConnectorCatalogEntryModel]


def _field_model(field: CatalogField) -> ConnectorCatalogFieldModel:
    return ConnectorCatalogFieldModel(
        id=field.id,
        label=field.label,
        placeholder=field.placeholder,
        helper_text=field.helper_text,
        get_token_instructions=field.get_token_instructions,
        prefix_hint=field.prefix_hint,
    )


def _auth_style_model(style: HttpAuthStyle | None) -> ConnectorHttpAuthStyleModel | None:
    if style is None:
        return None
    return ConnectorHttpAuthStyleModel(
        kind=style.kind,
        header_name=style.header_name,
        parameter_name=style.parameter_name,
    )


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


def _settings_schema(entry: CatalogEntry) -> list[ConnectorSettingsFieldModel]:
    if entry.id != "supabase":
        return []
    return [
        ConnectorSettingsFieldModel(
            id="projectRef",
            kind="string",
            required=True,
            affects_url=True,
        ),
        ConnectorSettingsFieldModel(
            id="readOnly",
            kind="boolean",
            required=True,
            affects_url=True,
        ),
    ]


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
        auth_style=_auth_style_model(entry.auth_style),
        auth_field_id=entry.auth_field_id,
        url=entry.url,
        command=entry.command or None,
        args=[_arg_model(template) for template in entry.args],
        env=[_env_model(template) for template in entry.env],
        server_name_base=entry.server_name_base,
        icon_id=entry.icon_id,
        required_fields=[_field_model(field) for field in entry.required_fields],
        settings_schema=_settings_schema(entry),
        capabilities=list(entry.capabilities),
    )


def catalog_response(entries: list[CatalogEntry]) -> ConnectorCatalogResponse:
    return ConnectorCatalogResponse(
        catalog_version=CATALOG_VERSION,
        entries=[catalog_entry_payload(entry) for entry in entries],
    )
