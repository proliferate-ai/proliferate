from __future__ import annotations

import hashlib
from pathlib import Path

from proliferate.server.cloud.plugins.catalog.domain.types import (
    PluginSkill,
    PluginSkillProvenance,
    PluginSkillResource,
    SkillImportMode,
    SkillReviewStatus,
)


SKILL_ROOT = Path(__file__).resolve().parent / "first_party"


def adapted_skill(
    *,
    id: str,
    display_name: str,
    description: str,
    relative_path: str,
    required_mcp_server_refs: tuple[str, ...],
    source_repo_url: str,
    source_path: str,
    source_ref: str,
    source_sha256: str,
    source_license: str,
    review_status: SkillReviewStatus = "reviewed",
    reviewer: str = "Proliferate architecture review",
    reviewed_at: str = "2026-05-13",
    import_mode: SkillImportMode = "adapted",
    requires_credential_binding: bool = True,
    resources: tuple[PluginSkillResource, ...] = (),
    default_enabled: bool = True,
    notes: str = "",
) -> PluginSkill:
    instructions = read_skill_file(relative_path)
    return PluginSkill(
        id=id,
        display_name=display_name,
        description=description,
        instructions=instructions,
        required_mcp_server_refs=required_mcp_server_refs,
        requires_credential_binding=requires_credential_binding,
        resources=resources,
        default_enabled=default_enabled,
        provenance=PluginSkillProvenance(
            source_repo_url=source_repo_url,
            source_path=source_path,
            source_ref=source_ref,
            source_sha256=source_sha256,
            adapted_sha256=sha256_text(instructions),
            source_license=source_license,
            import_mode=import_mode,
            review_status=review_status,
            reviewer=reviewer,
            reviewed_at=reviewed_at,
            notes=notes,
        ),
    )


def read_skill_file(relative_path: str) -> str:
    path = (SKILL_ROOT / relative_path).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"plugin skill file not found: {relative_path}")
    if SKILL_ROOT not in path.parents:
        raise ValueError(f"plugin skill path escapes first_party root: {relative_path}")
    return path.read_text(encoding="utf-8").strip()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
