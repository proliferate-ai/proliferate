"""Schemas for cloud live stream messages."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CloudStreamHeartbeatResponse(BaseModel):
    kind: str = "heartbeat"


class CloudLivePatchEnvelope(BaseModel):
    kind: str = "projection_patch"
    patch: dict[str, object] = Field(serialization_alias="patch")
