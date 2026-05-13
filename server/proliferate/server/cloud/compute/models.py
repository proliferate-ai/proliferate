"""Schemas for compute lifecycle APIs."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class WorkspaceComputeCommandRequest(BaseModel):
    target_id: UUID = Field(alias="targetId")
    idempotency_key: str = Field(alias="idempotencyKey")
    reason: str | None = None
    force: bool = False
