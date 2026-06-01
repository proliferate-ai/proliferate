from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_skills import (
    CloudSkillConfiguredItemSnapshot,
)


class CreateSkillConfiguredItemRequest(BaseModel):
    skill_source_kind: str = Field(alias="skillSourceKind")
    skill_id: str = Field(alias="skillId")
    skill_version: str | None = Field(default=None, alias="skillVersion")
    plugin_id: str = Field(default="", alias="pluginId")
    plugin_version: str | None = Field(default=None, alias="pluginVersion")
    enabled: bool = True


class PatchSkillConfiguredItemRequest(BaseModel):
    enabled: bool | None = None
    public_to_org: bool | None = Field(default=None, alias="publicToOrg")
    public_organization_id: UUID | None = Field(default=None, alias="publicOrganizationId")


class SkillConfiguredItemResponse(BaseModel):
    id: str
    owner_scope: str = Field(serialization_alias="ownerScope")
    owner_user_id: str | None = Field(default=None, serialization_alias="ownerUserId")
    organization_id: str | None = Field(default=None, serialization_alias="organizationId")
    skill_source_kind: str = Field(serialization_alias="skillSourceKind")
    skill_id: str = Field(serialization_alias="skillId")
    skill_version: str | None = Field(default=None, serialization_alias="skillVersion")
    plugin_id: str = Field(serialization_alias="pluginId")
    plugin_version: str | None = Field(default=None, serialization_alias="pluginVersion")
    enabled: bool
    public_to_org: bool = Field(serialization_alias="publicToOrg")
    public_organization_id: str | None = Field(
        default=None,
        serialization_alias="publicOrganizationId",
    )
    public_status: str = Field(serialization_alias="publicStatus")
    config_version: int = Field(serialization_alias="configVersion")
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")


class SkillConfiguredItemsResponse(BaseModel):
    skills: list[SkillConfiguredItemResponse]


def skill_configured_item_payload(
    item: CloudSkillConfiguredItemSnapshot,
) -> SkillConfiguredItemResponse:
    return SkillConfiguredItemResponse(
        id=str(item.id),
        owner_scope=item.owner_scope,
        owner_user_id=str(item.owner_user_id) if item.owner_user_id else None,
        organization_id=str(item.organization_id) if item.organization_id else None,
        skill_source_kind=item.skill_source_kind,
        skill_id=item.skill_id,
        skill_version=item.skill_version,
        plugin_id=item.plugin_id,
        plugin_version=item.plugin_version,
        enabled=item.enabled,
        public_to_org=item.public_to_org,
        public_organization_id=(
            str(item.public_organization_id) if item.public_organization_id else None
        ),
        public_status=item.public_status,
        config_version=item.config_version,
        created_at=item.created_at.isoformat(),
        updated_at=item.updated_at.isoformat(),
    )
