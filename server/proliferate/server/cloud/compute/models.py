"""Request and response models for cloud compute operations."""

from __future__ import annotations

from pydantic import BaseModel, Field

from proliferate.server.cloud.targets.models import CloudTargetDetail


class SetDesiredVersionsRequest(BaseModel):
    update_channel: str | None = Field(default=None, alias="updateChannel")
    anyharness_version: str | None = Field(default=None, alias="anyharnessVersion")
    worker_version: str | None = Field(default=None, alias="workerVersion")
    supervisor_version: str | None = Field(default=None, alias="supervisorVersion")


class SetDesiredVersionsResponse(BaseModel):
    target: CloudTargetDetail


class SafeStopCheckResponse(BaseModel):
    target_id: str = Field(serialization_alias="targetId")
    allowed: bool
    reasons: list[str]
    active_session_count: int = Field(serialization_alias="activeSessionCount")
    active_command_count: int = Field(serialization_alias="activeCommandCount")


class RevokeWorkersResponse(BaseModel):
    target_id: str = Field(serialization_alias="targetId")
    revoked: bool
