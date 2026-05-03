from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

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
    "invalid_settings",
]


class MaterializeCloudMcpRequest(BaseModel):
    target_location: Literal["local", "cloud"] = Field(alias="targetLocation")
    connection_ids: list[str] | None = Field(default=None, alias="connectionIds")


class SessionMcpHeaderModel(BaseModel):
    name: str
    value: str = Field(repr=False)


class SessionMcpEnvVarModel(BaseModel):
    name: str
    value: str = Field(repr=False)


class SessionMcpHttpServerModel(BaseModel):
    transport: Literal["http"] = "http"
    connection_id: str = Field(serialization_alias="connectionId")
    catalog_entry_id: str | None = Field(default=None, serialization_alias="catalogEntryId")
    server_name: str = Field(serialization_alias="serverName")
    url: str = Field(repr=False)
    headers: list[SessionMcpHeaderModel] = Field(default_factory=list, repr=False)


class SessionMcpStdioServerModel(BaseModel):
    transport: Literal["stdio"] = "stdio"
    connection_id: str = Field(serialization_alias="connectionId")
    catalog_entry_id: str | None = Field(default=None, serialization_alias="catalogEntryId")
    server_name: str = Field(serialization_alias="serverName")
    command: str
    args: list[str] = Field(default_factory=list, repr=False)
    env: list[SessionMcpEnvVarModel] = Field(default_factory=list, repr=False)


SessionMcpServerModel = SessionMcpHttpServerModel | SessionMcpStdioServerModel


class SessionMcpBindingSummaryModel(BaseModel):
    id: str
    server_name: str = Field(serialization_alias="serverName")
    display_name: str | None = Field(default=None, serialization_alias="displayName")
    transport: Literal["http", "stdio"]
    outcome: Literal["applied", "not_applied"]
    reason: McpNotAppliedReason | None = None


class LocalStdioStaticSourceModel(BaseModel):
    kind: Literal["static"]
    value: str = Field(repr=False)


class LocalStdioWorkspacePathSourceModel(BaseModel):
    kind: Literal["workspace_path"]


class LocalStdioArgTemplateModel(BaseModel):
    source: LocalStdioStaticSourceModel | LocalStdioWorkspacePathSourceModel


class LocalStdioEnvTemplateModel(BaseModel):
    name: str
    source: LocalStdioStaticSourceModel


class LocalStdioOAuthMetadataModel(BaseModel):
    provider: Literal["google_workspace"]
    user_google_email: str = Field(serialization_alias="userGoogleEmail", repr=False)
    required_scope: str = Field(serialization_alias="requiredScope", repr=False)


class LocalStdioCandidateModel(BaseModel):
    connection_id: str = Field(serialization_alias="connectionId")
    catalog_entry_id: str | None = Field(default=None, serialization_alias="catalogEntryId")
    custom_definition_id: str | None = Field(
        default=None,
        serialization_alias="customDefinitionId",
    )
    server_name: str = Field(serialization_alias="serverName")
    connector_name: str = Field(serialization_alias="connectorName")
    setup_kind: Literal["none", "local_oauth"] = Field(
        default="none",
        serialization_alias="setupKind",
    )
    local_oauth: LocalStdioOAuthMetadataModel | None = Field(
        default=None,
        serialization_alias="localOauth",
        repr=False,
    )
    command: str
    args: list[LocalStdioArgTemplateModel] = Field(repr=False)
    env: list[LocalStdioEnvTemplateModel] = Field(repr=False)


class CloudMcpMaterializationWarningModel(BaseModel):
    connection_id: str = Field(serialization_alias="connectionId")
    catalog_entry_id: str | None = Field(default=None, serialization_alias="catalogEntryId")
    custom_definition_id: str | None = Field(
        default=None,
        serialization_alias="customDefinitionId",
    )
    connector_name: str = Field(serialization_alias="connectorName")
    server_name: str | None = Field(default=None, serialization_alias="serverName")
    kind: McpWarningKind


class MaterializeCloudMcpResponse(BaseModel):
    catalog_version: str = Field(serialization_alias="catalogVersion")
    mcp_servers: list[SessionMcpServerModel] = Field(
        serialization_alias="mcpServers",
        repr=False,
    )
    mcp_binding_summaries: list[SessionMcpBindingSummaryModel] = Field(
        serialization_alias="mcpBindingSummaries"
    )
    local_stdio_candidates: list[LocalStdioCandidateModel] = Field(
        serialization_alias="localStdioCandidates",
        repr=False,
    )
    warnings: list[CloudMcpMaterializationWarningModel]


def local_stdio_static_arg_payload(value: str) -> LocalStdioArgTemplateModel:
    return LocalStdioArgTemplateModel(
        source=LocalStdioStaticSourceModel(kind="static", value=value)
    )


def local_stdio_workspace_path_arg_payload() -> LocalStdioArgTemplateModel:
    return LocalStdioArgTemplateModel(
        source=LocalStdioWorkspacePathSourceModel(kind="workspace_path")
    )


def local_stdio_static_env_payload(name: str, value: str) -> LocalStdioEnvTemplateModel:
    return LocalStdioEnvTemplateModel(
        name=name,
        source=LocalStdioStaticSourceModel(kind="static", value=value),
    )
