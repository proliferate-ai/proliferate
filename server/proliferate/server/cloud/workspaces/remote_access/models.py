from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.constants.cloud import CloudAgentKind


class RemoteAccessRepoRef(BaseModel):
    provider: str = "local"
    owner: str = "local"
    name: str
    branch: str = "default"
    base_branch: str | None = Field(default=None, alias="baseBranch")


class BootstrapWorkspaceRemoteAccessRequest(BaseModel):
    target_id: UUID = Field(alias="targetId")
    anyharness_workspace_id: str = Field(alias="anyharnessWorkspaceId", min_length=1)
    anyharness_session_id: str | None = Field(default=None, alias="anyharnessSessionId")
    display_name: str | None = Field(default=None, alias="displayName")
    repo: RemoteAccessRepoRef | None = None


class WorkspaceConnection(BaseModel):
    runtime_url: str = Field(serialization_alias="runtimeUrl")
    access_token: str = Field(serialization_alias="accessToken")
    anyharness_workspace_id: str | None = Field(serialization_alias="anyharnessWorkspaceId")
    runtime_generation: int = Field(serialization_alias="runtimeGeneration")
    allowed_agent_kinds: list[CloudAgentKind] = Field(serialization_alias="allowedAgentKinds")
    ready_agent_kinds: list[str] = Field(serialization_alias="readyAgentKinds")
