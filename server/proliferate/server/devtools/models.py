"""Local development helper API models."""

from __future__ import annotations

from pydantic import BaseModel, Field


class DevDesktopHandoffRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class DevDesktopHandoffRecordResponse(BaseModel):
    id: str
    url: str
    created_at: str = Field(alias="createdAt")


class DevDesktopHandoffPollResponse(BaseModel):
    handoff: DevDesktopHandoffRecordResponse | None

