from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SupportMessageContext(BaseModel):
    source: Literal["sidebar", "home", "settings", "cloud_gated"] = "sidebar"
    intent: Literal["general", "unlimited_cloud", "team_features"] = "general"
    pathname: str | None = Field(default=None, max_length=255)
    workspace_id: str | None = Field(default=None, alias="workspaceId", max_length=255)
    workspace_name: str | None = Field(default=None, alias="workspaceName", max_length=255)
    workspace_location: Literal["local", "cloud"] | None = Field(
        default=None,
        alias="workspaceLocation",
    )


class SupportMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    context: SupportMessageContext | None = None


class SupportMessageResponse(BaseModel):
    ok: bool = True
