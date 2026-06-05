from __future__ import annotations

from pydantic import BaseModel, Field

from proliferate.server.cloud.mobility.models import MobilityWorkspaceDetail


class WorkspaceMobilityPreflightRequest(BaseModel):
    direction: str
    requested_branch: str = Field(alias="requestedBranch")
    requested_base_sha: str | None = Field(default=None, alias="requestedBaseSha")


class WorkspaceMobilityPreflightBlocker(BaseModel):
    code: str
    message: str
    source: str = "cloud"
    retry_action: str | None = Field(default=None, serialization_alias="retryAction")
    details: dict[str, str] | None = None


class WorkspaceMobilityPreflightResponse(BaseModel):
    can_start: bool = Field(serialization_alias="canStart")
    blockers: list[WorkspaceMobilityPreflightBlocker]
    excluded_paths: list[str] = Field(serialization_alias="excludedPaths")
    workspace: MobilityWorkspaceDetail
