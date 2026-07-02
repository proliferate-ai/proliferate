"""Request and response models for cloud compute targets.

Minimal direct-runtime reintroduction: only the ownership/identity shape of
the minimal ``cloud_targets`` registry is exposed. Inventory, worker status,
and update-channel payloads return with the worker slice of the stack.

The per-runtime AnyHarness bearer appears in exactly two payloads — the
enrollment response (once, alongside the enrollment token, so it can reach
the Desktop installer flow) and the runtime-access response (owner-gated
direct attach). It must never be added to summary/detail payloads.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_sync.targets import CloudTargetSnapshot


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


class CloudTargetSummary(BaseModel):
    id: str
    display_name: str = Field(serialization_alias="displayName")
    kind: str
    status: str
    owner_scope: str = Field(serialization_alias="ownerScope")
    organization_id: str | None = Field(default=None, serialization_alias="organizationId")
    archived_at: str | None = Field(default=None, serialization_alias="archivedAt")
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")


class CloudTargetDetail(CloudTargetSummary):
    owner_user_id: str | None = Field(default=None, serialization_alias="ownerUserId")
    created_by_user_id: str = Field(serialization_alias="createdByUserId")


class CloudTargetEnrollmentRequest(BaseModel):
    display_name: str = Field(alias="displayName")
    kind: str = "ssh"
    owner_scope: Literal["personal", "organization"] = Field(
        default="personal",
        alias="ownerScope",
    )
    organization_id: UUID | None = Field(default=None, alias="organizationId")
    ttl_seconds: int | None = Field(default=None, alias="ttlSeconds")


class CloudTargetExistingEnrollmentRequest(BaseModel):
    ttl_seconds: int | None = Field(default=None, alias="ttlSeconds")


class CloudTargetEnrollmentResponse(BaseModel):
    target: CloudTargetDetail
    enrollment_token: str = Field(serialization_alias="enrollmentToken")
    anyharness_bearer_token: str = Field(serialization_alias="anyharnessBearerToken")
    install_command: str = Field(serialization_alias="installCommand")
    artifact_base_url: str | None = Field(default=None, serialization_alias="artifactBaseUrl")
    expires_at: str = Field(serialization_alias="expiresAt")


class CloudTargetRuntimeAccessResponse(BaseModel):
    anyharness_bearer_token: str = Field(serialization_alias="anyharnessBearerToken")


def target_summary_payload(value: CloudTargetSnapshot) -> CloudTargetSummary:
    return CloudTargetSummary(
        id=str(value.id),
        display_name=value.display_name,
        kind=value.kind,
        status=value.status,
        owner_scope=value.owner_scope,
        organization_id=str(value.organization_id) if value.organization_id else None,
        archived_at=_to_iso(value.archived_at),
        created_at=_to_iso(value.created_at),
        updated_at=_to_iso(value.updated_at),
    )


def target_detail_payload(value: CloudTargetSnapshot) -> CloudTargetDetail:
    return CloudTargetDetail(
        **target_summary_payload(value).model_dump(),
        owner_user_id=str(value.owner_user_id) if value.owner_user_id else None,
        created_by_user_id=str(value.created_by_user_id),
    )
