"""API models for managed cloud sandboxes."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from proliferate.db.store.managed_sandboxes import ManagedSandboxValue


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


class ManagedSandboxResponse(BaseModel):
    id: str
    owner_scope: str = Field(serialization_alias="ownerScope")
    owner_user_id: str | None = Field(serialization_alias="ownerUserId")
    organization_id: str | None = Field(serialization_alias="organizationId")
    status: str
    last_error: str | None = Field(serialization_alias="lastError")
    e2b_sandbox_id: str | None = Field(serialization_alias="e2bSandboxId")
    e2b_template_ref: str = Field(serialization_alias="e2bTemplateRef")
    anyharness_base_url: str | None = Field(serialization_alias="anyharnessBaseUrl")
    runtime_generation: int = Field(serialization_alias="runtimeGeneration")
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")
    ready_at: str | None = Field(serialization_alias="readyAt")
    last_health_at: str | None = Field(serialization_alias="lastHealthAt")
    destroyed_at: str | None = Field(serialization_alias="destroyedAt")


def managed_sandbox_payload(value: ManagedSandboxValue) -> ManagedSandboxResponse:
    return ManagedSandboxResponse(
        id=str(value.id),
        owner_scope=value.owner_scope,
        owner_user_id=str(value.owner_user_id) if value.owner_user_id else None,
        organization_id=str(value.organization_id) if value.organization_id else None,
        status=value.status,
        last_error=value.last_error,
        e2b_sandbox_id=value.e2b_sandbox_id,
        e2b_template_ref=value.e2b_template_ref,
        anyharness_base_url=value.anyharness_base_url,
        runtime_generation=value.runtime_generation,
        created_at=value.created_at.isoformat(),
        updated_at=value.updated_at.isoformat(),
        ready_at=_to_iso(value.ready_at),
        last_health_at=_to_iso(value.last_health_at),
        destroyed_at=_to_iso(value.destroyed_at),
    )
