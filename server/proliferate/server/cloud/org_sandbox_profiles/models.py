"""API models for organization sandbox profiles."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_sandboxes import CloudSandboxValue


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


class OrgSandboxProfileResponse(BaseModel):
    id: str
    organization_id: str = Field(serialization_alias="organizationId")
    display_name: str | None = Field(serialization_alias="displayName")
    status: str
    created_by_user_id: str | None = Field(serialization_alias="createdByUserId")
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")
    ready_at: str | None = Field(serialization_alias="readyAt")


class OrgSandboxProfileListResponse(BaseModel):
    profiles: list[OrgSandboxProfileResponse]


class CreateOrgSandboxProfileRequest(BaseModel):
    display_name: str = Field(alias="displayName", min_length=1, max_length=128)


def org_sandbox_profile_payload(value: CloudSandboxValue) -> OrgSandboxProfileResponse:
    return OrgSandboxProfileResponse(
        id=str(value.id),
        organization_id=str(value.organization_id) if value.organization_id else "",
        display_name=value.display_name,
        status=value.status,
        created_by_user_id=(
            str(value.created_by_user_id) if value.created_by_user_id else None
        ),
        created_at=value.created_at.isoformat(),
        updated_at=value.updated_at.isoformat(),
        ready_at=_to_iso(value.ready_at),
    )
