from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


SkillImportMode = Literal["adapted", "vendored"]
SkillReviewStatus = Literal["reviewed", "pending"]


@dataclass(frozen=True)
class PluginSkillProvenance:
    source_repo_url: str
    source_path: str
    source_ref: str
    source_sha256: str
    adapted_sha256: str
    source_license: str
    import_mode: SkillImportMode
    review_status: SkillReviewStatus
    reviewer: str
    reviewed_at: str
    notes: str = ""


@dataclass(frozen=True)
class PluginSkillResource:
    resource_id: str
    display_name: str | None
    content_type: str
    content: str


@dataclass(frozen=True)
class PluginSkill:
    id: str
    display_name: str
    description: str
    instructions: str
    required_mcp_server_refs: tuple[str, ...]
    requires_credential_binding: bool
    resources: tuple[PluginSkillResource, ...]
    default_enabled: bool
    provenance: PluginSkillProvenance


@dataclass(frozen=True)
class PluginPackage:
    id: str
    catalog_entry_id: str
    version: str
    display_name: str
    description: str
    skills: tuple[PluginSkill, ...]

