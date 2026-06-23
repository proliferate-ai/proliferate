"""HTTP schemas for organization integration catalog policy."""

from __future__ import annotations

from pydantic import BaseModel, Field

from proliferate.server.cloud.integration_policy.domain.types import (
    OrganizationIntegrationPolicyEntry,
    OrganizationIntegrationPolicySnapshot,
)


class PatchCloudOrganizationIntegrationPolicyRequest(BaseModel):
    catalog_entry_id: str = Field(alias="catalogEntryId")
    enabled: bool


class CloudOrganizationIntegrationPolicyItem(BaseModel):
    catalog_entry_id: str = Field(serialization_alias="catalogEntryId")
    enabled: bool
    updated_at: str | None = Field(default=None, serialization_alias="updatedAt")
    updated_by_user_id: str | None = Field(
        default=None,
        serialization_alias="updatedByUserId",
    )


class CloudOrganizationIntegrationPolicyResponse(BaseModel):
    organization_id: str = Field(serialization_alias="organizationId")
    entries: list[CloudOrganizationIntegrationPolicyItem]


def _entry_payload(
    entry: OrganizationIntegrationPolicyEntry,
) -> CloudOrganizationIntegrationPolicyItem:
    return CloudOrganizationIntegrationPolicyItem(
        catalog_entry_id=entry.catalog_entry_id,
        enabled=entry.enabled,
        updated_at=entry.updated_at.isoformat() if entry.updated_at else None,
        updated_by_user_id=(
            str(entry.updated_by_user_id) if entry.updated_by_user_id else None
        ),
    )


def organization_integration_policy_payload(
    snapshot: OrganizationIntegrationPolicySnapshot,
) -> CloudOrganizationIntegrationPolicyResponse:
    return CloudOrganizationIntegrationPolicyResponse(
        organization_id=str(snapshot.organization_id),
        entries=[_entry_payload(entry) for entry in snapshot.entries],
    )
