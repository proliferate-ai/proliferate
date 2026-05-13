from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from proliferate.server.cloud.plugins.catalog.domain.types import (
    PluginPackage,
    PluginSkill,
    PluginSkillProvenance,
    PluginSkillResource,
)


class PluginSkillProvenanceModel(BaseModel):
    source_repo_url: str = Field(serialization_alias="sourceRepoUrl")
    source_path: str = Field(serialization_alias="sourcePath")
    source_ref: str = Field(serialization_alias="sourceRef")
    source_sha256: str = Field(serialization_alias="sourceSha256")
    adapted_sha256: str = Field(serialization_alias="adaptedSha256")
    source_license: str = Field(serialization_alias="sourceLicense")
    import_mode: Literal["adapted", "vendored"] = Field(serialization_alias="importMode")
    review_status: Literal["reviewed", "pending"] = Field(serialization_alias="reviewStatus")
    reviewer: str
    reviewed_at: str = Field(serialization_alias="reviewedAt")
    notes: str = ""


class PluginSkillResourceModel(BaseModel):
    resource_id: str = Field(serialization_alias="resourceId")
    display_name: str | None = Field(default=None, serialization_alias="displayName")
    content_type: str = Field(serialization_alias="contentType")
    content: str


class PluginPackageSkillModel(BaseModel):
    id: str
    display_name: str = Field(serialization_alias="displayName")
    description: str
    instructions: str
    required_mcp_server_refs: list[str] = Field(serialization_alias="requiredMcpServerRefs")
    requires_credential_binding: bool = Field(serialization_alias="requiresCredentialBinding")
    resources: list[PluginSkillResourceModel] = Field(default_factory=list)
    default_enabled: bool = Field(serialization_alias="defaultEnabled")
    provenance: PluginSkillProvenanceModel


class PluginPackageModel(BaseModel):
    id: str
    catalog_entry_id: str = Field(serialization_alias="catalogEntryId")
    version: str
    display_name: str = Field(serialization_alias="displayName")
    description: str
    skills: list[PluginPackageSkillModel] = Field(default_factory=list)


def plugin_package_payload(package: PluginPackage) -> PluginPackageModel:
    return PluginPackageModel(
        id=package.id,
        catalog_entry_id=package.catalog_entry_id,
        version=package.version,
        display_name=package.display_name,
        description=package.description,
        skills=[_skill_payload(skill) for skill in package.skills],
    )


def _skill_payload(skill: PluginSkill) -> PluginPackageSkillModel:
    return PluginPackageSkillModel(
        id=skill.id,
        display_name=skill.display_name,
        description=skill.description,
        instructions=skill.instructions,
        required_mcp_server_refs=list(skill.required_mcp_server_refs),
        requires_credential_binding=skill.requires_credential_binding,
        resources=[_resource_payload(resource) for resource in skill.resources],
        default_enabled=skill.default_enabled,
        provenance=_provenance_payload(skill.provenance),
    )


def _resource_payload(resource: PluginSkillResource) -> PluginSkillResourceModel:
    return PluginSkillResourceModel(
        resource_id=resource.resource_id,
        display_name=resource.display_name,
        content_type=resource.content_type,
        content=resource.content,
    )


def _provenance_payload(provenance: PluginSkillProvenance) -> PluginSkillProvenanceModel:
    return PluginSkillProvenanceModel(
        source_repo_url=provenance.source_repo_url,
        source_path=provenance.source_path,
        source_ref=provenance.source_ref,
        source_sha256=provenance.source_sha256,
        adapted_sha256=provenance.adapted_sha256,
        source_license=provenance.source_license,
        import_mode=provenance.import_mode,
        review_status=provenance.review_status,
        reviewer=provenance.reviewer,
        reviewed_at=provenance.reviewed_at,
        notes=provenance.notes,
    )
