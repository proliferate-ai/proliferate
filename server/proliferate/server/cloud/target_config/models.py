"""Request/response models for cloud target environment materialization."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal, cast
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.cloud_sync.target_config import CloudTargetConfigSnapshot
from proliferate.server.cloud.commands.models import CloudCommandResponse
from proliferate.server.cloud.runtime_config.models import RuntimeConfigMaterializationFragment


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _json_dict(value: str) -> dict[str, object]:
    parsed = cast(object, json.loads(value))
    return parsed if isinstance(parsed, dict) else {"value": parsed}


class MaterializeTargetConfigRequest(BaseModel):
    git_provider: Literal["github"] = Field(default="github", alias="gitProvider")
    git_owner: str = Field(alias="gitOwner", min_length=1)
    git_repo_name: str = Field(alias="gitRepoName", min_length=1)
    workspace_root: str | None = Field(default=None, alias="workspaceRoot")
    mcp_connection_ids: list[str] | None = Field(default=None, alias="mcpConnectionIds")
    include_agent_credentials: bool = Field(default=True, alias="includeAgentCredentials")
    include_git_credentials: bool = Field(default=True, alias="includeGitCredentials")
    source: str | None = None
    idempotency_key: str | None = Field(default=None, alias="idempotencyKey")


class TargetConfigTrackedFileModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    relative_path: str = Field(alias="relativePath")
    content: str = Field(repr=False)
    content_sha256: str = Field(alias="contentSha256")
    byte_size: int = Field(alias="byteSize")


class TargetConfigGitCredentialModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    provider: Literal["github"] = "github"
    access_token: str = Field(alias="accessToken", repr=False)
    username: str | None = None
    email: str | None = None


class TargetConfigRepoModel(BaseModel):
    provider: Literal["github"] = "github"
    owner: str
    name: str


class TargetConfigMaterializationPlan(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    target_config_id: str = Field(alias="targetConfigId")
    target_id: str = Field(alias="targetId")
    config_version: int = Field(alias="configVersion")
    workspace_root: str = Field(alias="workspaceRoot")
    repo: TargetConfigRepoModel
    env_vars: dict[str, str] = Field(alias="envVars", repr=False)
    tracked_files: list[TargetConfigTrackedFileModel] = Field(
        alias="trackedFiles",
        repr=False,
    )
    setup_script: str = Field(default="", alias="setupScript", repr=False)
    run_command: str = Field(default="", alias="runCommand")
    git_credential: TargetConfigGitCredentialModel | None = Field(
        default=None,
        alias="gitCredential",
        repr=False,
    )
    agent_credentials: dict[str, dict[str, Any]] = Field(
        default_factory=dict,
        alias="agentCredentials",
        repr=False,
    )
    runtime_config: RuntimeConfigMaterializationFragment | None = Field(
        default=None,
        alias="runtimeConfig",
        repr=False,
    )
    mcp: dict[str, Any] | None = Field(default=None, repr=False)
    skills: list[dict[str, Any]] = Field(default_factory=list)
    readiness_requirements: dict[str, object] = Field(
        default_factory=dict,
        alias="readinessRequirements",
    )


class TargetConfigSummaryModel(BaseModel):
    env_var_count: int = Field(serialization_alias="envVarCount")
    tracked_file_count: int = Field(serialization_alias="trackedFileCount")
    has_git_credential: bool = Field(serialization_alias="hasGitCredential")
    agent_credential_providers: list[str] = Field(serialization_alias="agentCredentialProviders")
    mcp_binding_count: int = Field(serialization_alias="mcpBindingCount")
    mcp_warning_count: int = Field(serialization_alias="mcpWarningCount")
    required_tools: list[str] = Field(serialization_alias="requiredTools")


class CloudTargetConfigResponse(BaseModel):
    id: str
    target_id: str = Field(serialization_alias="targetId")
    git_provider: str = Field(serialization_alias="gitProvider")
    git_owner: str = Field(serialization_alias="gitOwner")
    git_repo_name: str = Field(serialization_alias="gitRepoName")
    workspace_root: str = Field(serialization_alias="workspaceRoot")
    config_version: int = Field(serialization_alias="configVersion")
    env_vars_version: int = Field(serialization_alias="envVarsVersion")
    files_version: int = Field(serialization_alias="filesVersion")
    credential_snapshot_version: int = Field(serialization_alias="credentialSnapshotVersion")
    mcp_materialization_version: int = Field(serialization_alias="mcpMaterializationVersion")
    materialization_status: str = Field(serialization_alias="materializationStatus")
    last_command_id: str | None = Field(default=None, serialization_alias="lastCommandId")
    last_materialized_at: str | None = Field(
        default=None,
        serialization_alias="lastMaterializedAt",
    )
    last_error_code: str | None = Field(default=None, serialization_alias="lastErrorCode")
    last_error_message: str | None = Field(default=None, serialization_alias="lastErrorMessage")
    summary: TargetConfigSummaryModel
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")


class MaterializeTargetConfigResponse(BaseModel):
    target_config: CloudTargetConfigResponse = Field(serialization_alias="targetConfig")
    command: CloudCommandResponse


class WorkerTargetConfigStatusRequest(BaseModel):
    status: Literal["materializing", "applied", "failed"]
    command_id: UUID = Field(alias="commandId")
    config_version: int = Field(alias="configVersion")
    lease_id: str = Field(alias="leaseId")
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")


class WorkerTargetConfigStatusResponse(BaseModel):
    target_config_id: str = Field(serialization_alias="targetConfigId")
    status: str
    updated: bool


def target_config_payload(value: CloudTargetConfigSnapshot) -> CloudTargetConfigResponse:
    return CloudTargetConfigResponse(
        id=str(value.id),
        target_id=str(value.target_id),
        git_provider=value.git_provider,
        git_owner=value.git_owner,
        git_repo_name=value.git_repo_name,
        workspace_root=value.workspace_root,
        config_version=value.config_version,
        env_vars_version=value.env_vars_version,
        files_version=value.files_version,
        credential_snapshot_version=value.credential_snapshot_version,
        mcp_materialization_version=value.mcp_materialization_version,
        materialization_status=value.materialization_status,
        last_command_id=str(value.last_command_id) if value.last_command_id else None,
        last_materialized_at=_to_iso(value.last_materialized_at),
        last_error_code=value.last_error_code,
        last_error_message=value.last_error_message,
        summary=TargetConfigSummaryModel(**_json_dict(value.summary_json)),
        created_at=_to_iso(value.created_at) or "",
        updated_at=_to_iso(value.updated_at) or "",
    )
