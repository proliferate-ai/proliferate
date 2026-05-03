"""Request and response schemas for user-owned custom MCP definitions."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.cloud_mcp.types import CloudMcpCustomDefinitionRecord


class CustomMcpTemplateValueModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    value_template: str = Field(alias="valueTemplate")


class CustomMcpHttpTemplateModel(BaseModel):
    url: str
    headers: list[CustomMcpTemplateValueModel] = Field(default_factory=list)
    query: list[CustomMcpTemplateValueModel] = Field(default_factory=list)


class CustomMcpStdioEnvTemplateModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    value_template: str = Field(alias="valueTemplate")


class CustomMcpStdioTemplateModel(BaseModel):
    command: str
    args: list[str] = Field(default_factory=list)
    env: list[CustomMcpStdioEnvTemplateModel] = Field(default_factory=list)


class CustomMcpSecretFieldModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    label: str
    placeholder: str = ""
    helper_text: str = Field(default="", alias="helperText")
    get_token_instructions: str = Field(default="", alias="getTokenInstructions")
    prefix_hint: str | None = Field(default=None, alias="prefixHint")


class CreateCustomMcpDefinitionRequest(BaseModel):
    definition_id: str | None = Field(default=None, alias="definitionId")
    name: str
    description: str = ""
    availability: Literal["universal", "local_only", "cloud_only"] = "local_only"
    transport: Literal["http", "stdio"]
    auth_kind: Literal["secret", "none"] = Field(alias="authKind")
    http: CustomMcpHttpTemplateModel | None = None
    stdio: CustomMcpStdioTemplateModel | None = None
    secret_fields: list[CustomMcpSecretFieldModel] = Field(
        default_factory=list,
        alias="secretFields",
    )
    enabled: bool = True


class PatchCustomMcpDefinitionRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    availability: Literal["universal", "local_only", "cloud_only"] | None = None
    transport: Literal["http", "stdio"] | None = None
    auth_kind: Literal["secret", "none"] | None = Field(default=None, alias="authKind")
    http: CustomMcpHttpTemplateModel | None = None
    stdio: CustomMcpStdioTemplateModel | None = None
    secret_fields: list[CustomMcpSecretFieldModel] | None = Field(
        default=None,
        alias="secretFields",
    )
    enabled: bool | None = None


class CustomMcpDefinitionSummaryModel(BaseModel):
    definition_id: str = Field(serialization_alias="definitionId")
    version: int
    name: str
    description: str
    availability: Literal["universal", "local_only", "cloud_only"]
    transport: Literal["http", "stdio"]
    auth_kind: Literal["secret", "none"] = Field(serialization_alias="authKind")
    display_url: str = Field(serialization_alias="displayUrl")
    server_name_base: str = Field(serialization_alias="serverNameBase")
    icon_id: str = Field(serialization_alias="iconId")
    secret_fields: list[CustomMcpSecretFieldModel] = Field(serialization_alias="secretFields")
    enabled: bool
    deleted_at: str | None = Field(serialization_alias="deletedAt")
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")


class CustomMcpDefinitionsResponse(BaseModel):
    definitions: list[CustomMcpDefinitionSummaryModel]


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def custom_definition_payload(
    record: CloudMcpCustomDefinitionRecord,
    *,
    display_url: str,
    server_name_base: str,
    icon_id: str,
    secret_fields: list[CustomMcpSecretFieldModel],
) -> CustomMcpDefinitionSummaryModel:
    return CustomMcpDefinitionSummaryModel(
        definition_id=record.definition_id,
        version=record.version,
        name=record.name,
        description=record.description,
        availability=cast(Literal["universal", "local_only", "cloud_only"], record.availability),
        transport=cast(Literal["http", "stdio"], record.transport),
        auth_kind=cast(Literal["secret", "none"], record.auth_kind),
        display_url=display_url,
        server_name_base=server_name_base,
        icon_id=icon_id,
        secret_fields=secret_fields,
        enabled=record.enabled,
        deleted_at=_to_iso(record.deleted_at),
        created_at=_to_iso(record.created_at) or "",
        updated_at=_to_iso(record.updated_at) or "",
    )
