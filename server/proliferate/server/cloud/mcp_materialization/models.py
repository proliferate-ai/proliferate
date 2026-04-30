from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from proliferate.server.cloud.mcp_catalog.catalog import ArgTemplate, EnvTemplate

McpWarningKind = Literal[
    "needs_reconnect",
    "unsupported_target",
    "invalid_settings",
    "refresh_failed",
    "missing_secret",
    "workspace_path_unresolved",
    "command_missing",
    "resolver_error",
]

McpNotAppliedReason = Literal[
    "missing_secret",
    "needs_reconnect",
    "unsupported_target",
    "workspace_path_unresolved",
    "policy_disabled",
    "resolver_error",
]


class MaterializeCloudMcpRequest(BaseModel):
    target_location: Literal["local", "cloud"] = Field(alias="targetLocation")
    connection_ids: list[str] | None = Field(default=None, alias="connectionIds")


class SessionMcpHeaderModel(BaseModel):
    name: str
    value: str


class SessionMcpEnvVarModel(BaseModel):
    name: str
    value: str


class SessionMcpHttpServerModel(BaseModel):
    transport: Literal["http"] = "http"
    connection_id: str = Field(serialization_alias="connectionId")
    catalog_entry_id: str | None = Field(default=None, serialization_alias="catalogEntryId")
    server_name: str = Field(serialization_alias="serverName")
    url: str
    headers: list[SessionMcpHeaderModel] = Field(default_factory=list)


class SessionMcpStdioServerModel(BaseModel):
    transport: Literal["stdio"] = "stdio"
    connection_id: str = Field(serialization_alias="connectionId")
    catalog_entry_id: str | None = Field(default=None, serialization_alias="catalogEntryId")
    server_name: str = Field(serialization_alias="serverName")
    command: str
    args: list[str] = Field(default_factory=list)
    env: list[SessionMcpEnvVarModel] = Field(default_factory=list)


SessionMcpServerModel = SessionMcpHttpServerModel | SessionMcpStdioServerModel


class SessionMcpBindingSummaryModel(BaseModel):
    id: str
    server_name: str = Field(serialization_alias="serverName")
    display_name: str | None = Field(default=None, serialization_alias="displayName")
    transport: Literal["http", "stdio"]
    outcome: Literal["applied", "not_applied"]
    reason: McpNotAppliedReason | None = None


class LocalStdioArgTemplateModel(BaseModel):
    source: dict[str, str]


class LocalStdioEnvTemplateModel(BaseModel):
    name: str
    source: dict[str, str]


class LocalStdioCandidateModel(BaseModel):
    connection_id: str = Field(serialization_alias="connectionId")
    catalog_entry_id: str = Field(serialization_alias="catalogEntryId")
    server_name: str = Field(serialization_alias="serverName")
    connector_name: str = Field(serialization_alias="connectorName")
    command: str
    args: list[LocalStdioArgTemplateModel]
    env: list[LocalStdioEnvTemplateModel]


class CloudMcpMaterializationWarningModel(BaseModel):
    connection_id: str = Field(serialization_alias="connectionId")
    catalog_entry_id: str = Field(serialization_alias="catalogEntryId")
    connector_name: str = Field(serialization_alias="connectorName")
    server_name: str | None = Field(default=None, serialization_alias="serverName")
    kind: McpWarningKind


class MaterializeCloudMcpResponse(BaseModel):
    catalog_version: str = Field(serialization_alias="catalogVersion")
    mcp_servers: list[SessionMcpServerModel] = Field(serialization_alias="mcpServers")
    mcp_binding_summaries: list[SessionMcpBindingSummaryModel] = Field(
        serialization_alias="mcpBindingSummaries"
    )
    local_stdio_candidates: list[LocalStdioCandidateModel] = Field(
        serialization_alias="localStdioCandidates"
    )
    warnings: list[CloudMcpMaterializationWarningModel]


def arg_template_payload(template: ArgTemplate) -> LocalStdioArgTemplateModel:
    if template.kind == "static":
        return LocalStdioArgTemplateModel(source={"kind": "static", "value": template.value or ""})
    return LocalStdioArgTemplateModel(source={"kind": "workspace_path"})


def env_template_payload(template: EnvTemplate) -> LocalStdioEnvTemplateModel:
    if template.kind == "static":
        return LocalStdioEnvTemplateModel(
            name=template.name,
            source={"kind": "static", "value": template.value or ""},
        )
    return LocalStdioEnvTemplateModel(
        name=template.name,
        source={"kind": "field", "fieldId": template.field_id or ""},
    )
