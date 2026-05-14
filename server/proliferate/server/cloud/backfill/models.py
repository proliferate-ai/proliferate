"""Request and response models for worker backfill."""

from __future__ import annotations

from pydantic import BaseModel, Field


class WorkerBackfillRepoRef(BaseModel):
    provider: str | None = Field(default=None, max_length=32)
    owner: str | None = Field(default=None, max_length=255)
    name: str | None = Field(default=None, max_length=255)
    branch: str | None = Field(default=None, max_length=255)
    base_branch: str | None = Field(default=None, alias="baseBranch", max_length=255)


class WorkerBackfillWorkspace(BaseModel):
    workspace_id: str = Field(alias="workspaceId", max_length=255)
    display_name: str | None = Field(default=None, alias="displayName", max_length=255)
    path: str | None = Field(default=None, max_length=4096)
    repo: WorkerBackfillRepoRef | None = None
    updated_at: str | None = Field(default=None, alias="updatedAt")


class WorkerBackfillPendingInteraction(BaseModel):
    request_id: str = Field(alias="requestId", max_length=255)
    kind: str | None = Field(default=None, max_length=64)
    title: str | None = None
    description: str | None = None
    payload: dict[str, object] | None = None


class WorkerBackfillSession(BaseModel):
    session_id: str = Field(alias="sessionId", max_length=255)
    workspace_id: str | None = Field(default=None, alias="workspaceId", max_length=255)
    native_session_id: str | None = Field(default=None, alias="nativeSessionId", max_length=255)
    source_agent_kind: str | None = Field(
        default=None,
        alias="sourceAgentKind",
        max_length=64,
    )
    title: str | None = None
    status: str | None = Field(default=None, max_length=32)
    phase: str | None = Field(default=None, max_length=64)
    live_config: dict[str, object] | None = Field(default=None, alias="liveConfig")
    last_event_seq: int = Field(default=0, alias="lastEventSeq", ge=0)
    last_event_at: str | None = Field(default=None, alias="lastEventAt")
    started_at: str | None = Field(default=None, alias="startedAt")
    ended_at: str | None = Field(default=None, alias="endedAt")
    pending_interactions: list[WorkerBackfillPendingInteraction] = Field(
        default_factory=list,
        alias="pendingInteractions",
        max_length=100,
    )


class WorkerBackfillRequest(BaseModel):
    workspaces: list[WorkerBackfillWorkspace] = Field(default_factory=list, max_length=200)
    sessions: list[WorkerBackfillSession] = Field(default_factory=list, max_length=500)


class WorkerBackfillWorkspaceMapping(BaseModel):
    workspace_id: str = Field(serialization_alias="workspaceId")
    cloud_workspace_id: str = Field(serialization_alias="cloudWorkspaceId")


class WorkerBackfillSessionMapping(BaseModel):
    session_id: str = Field(serialization_alias="sessionId")
    workspace_id: str | None = Field(default=None, serialization_alias="workspaceId")
    cloud_workspace_id: str | None = Field(default=None, serialization_alias="cloudWorkspaceId")


class WorkerBackfillResponse(BaseModel):
    mapped_workspaces: list[WorkerBackfillWorkspaceMapping] = Field(
        serialization_alias="mappedWorkspaces",
    )
    mapped_sessions: list[WorkerBackfillSessionMapping] = Field(
        serialization_alias="mappedSessions",
    )
