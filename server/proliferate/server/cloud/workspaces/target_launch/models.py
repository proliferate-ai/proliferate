from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.server.cloud.workspaces.models import WorkspaceDetail


class WorkspaceTargetLaunchSessionConfigUpdate(BaseModel):
    config_id: str = Field(alias="configId", min_length=1)
    value: str = Field(min_length=1)


class LaunchWorkspaceOnTargetRequest(BaseModel):
    target_id: UUID = Field(alias="targetId")
    git_provider: Literal["github"] = Field(alias="gitProvider")
    git_owner: str = Field(alias="gitOwner")
    git_repo_name: str = Field(alias="gitRepoName")
    base_branch: str | None = Field(default=None, alias="baseBranch")
    branch_name: str = Field(alias="branchName")
    display_name: str | None = Field(default=None, alias="displayName")
    prompt: str = Field(min_length=1)
    prompt_id: str | None = Field(default=None, alias="promptId")
    agent_kind: str = Field(default="claude", alias="agentKind")
    model_id: str | None = Field(default=None, alias="modelId")
    mode_id: str | None = Field(default=None, alias="modeId")
    session_config_updates: list[WorkspaceTargetLaunchSessionConfigUpdate] = Field(
        default_factory=list,
        alias="sessionConfigUpdates",
    )
    source: Literal["mobile", "web", "api"] = "mobile"


class WorkspaceTargetLaunchCommandIds(BaseModel):
    ensure_repo_checkout: str = Field(serialization_alias="ensureRepoCheckout")
    materialize_root: str = Field(serialization_alias="materializeRoot")
    materialize_worktree: str = Field(serialization_alias="materializeWorktree")
    start_session: str = Field(serialization_alias="startSession")
    send_prompt: str = Field(serialization_alias="sendPrompt")
    update_session_config: list[str] = Field(
        default_factory=list,
        serialization_alias="updateSessionConfig",
    )


class WorkspaceTargetLaunchResponse(BaseModel):
    workspace: WorkspaceDetail
    session_id: str = Field(serialization_alias="sessionId")
    send_command_id: str = Field(serialization_alias="sendCommandId")
    command_ids: WorkspaceTargetLaunchCommandIds = Field(serialization_alias="commandIds")
