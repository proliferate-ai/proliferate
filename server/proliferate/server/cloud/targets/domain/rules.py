"""Pure validation and formatting rules for cloud compute targets."""

from __future__ import annotations

import shlex
from uuid import UUID

from proliferate.constants.cloud import (
    CLOUD_TARGET_DEFAULT_ENROLLMENT_TTL_SECONDS,
    CLOUD_TARGET_MAX_ENROLLMENT_TTL_SECONDS,
    SUPPORTED_ENROLLABLE_CLOUD_TARGET_KINDS,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.targets.domain.types import CloudTargetOwnerScope

_DISPLAY_NAME_MAX_LENGTH = 255


def normalize_target_display_name(display_name: str) -> str:
    normalized = " ".join(display_name.strip().split())
    if not normalized:
        raise CloudApiError(
            "cloud_target_display_name_required",
            "Target display name is required.",
            status_code=400,
        )
    return normalized[:_DISPLAY_NAME_MAX_LENGTH]


def validate_enrollable_kind(kind: str) -> str:
    if kind not in SUPPORTED_ENROLLABLE_CLOUD_TARGET_KINDS:
        raise CloudApiError(
            "cloud_target_kind_unsupported",
            "This target kind cannot be enrolled with Proliferate Worker.",
            status_code=400,
        )
    return kind


def validate_owner_scope(
    *,
    owner_scope: str,
    organization_id: UUID | None,
) -> CloudTargetOwnerScope:
    if owner_scope == "personal":
        if organization_id is not None:
            raise CloudApiError(
                "cloud_target_personal_org_forbidden",
                "Personal targets cannot include an organization id.",
                status_code=400,
            )
        return "personal"
    if owner_scope == "organization":
        if organization_id is None:
            raise CloudApiError(
                "cloud_target_organization_required",
                "Organization targets require an organization id.",
                status_code=400,
            )
        return "organization"
    raise CloudApiError(
        "cloud_target_owner_scope_invalid",
        "Target owner scope must be personal or organization.",
        status_code=400,
    )


def clamp_enrollment_ttl_seconds(value: int | None) -> int:
    if value is None:
        return CLOUD_TARGET_DEFAULT_ENROLLMENT_TTL_SECONDS
    if value <= 0:
        raise CloudApiError(
            "cloud_target_enrollment_ttl_invalid",
            "Enrollment token TTL must be positive.",
            status_code=400,
        )
    return min(value, CLOUD_TARGET_MAX_ENROLLMENT_TTL_SECONDS)


def build_install_command(
    *,
    installer_url: str,
    cloud_base_url: str,
    enrollment_token: str,
    anyharness_bearer_token: str,
    artifact_base_url: str | None,
) -> str:
    env_parts = [
        f"PROLIFERATE_CLOUD_URL={shlex.quote(cloud_base_url)}",
        f"PROLIFERATE_ENROLLMENT_TOKEN={shlex.quote(enrollment_token)}",
        f"PROLIFERATE_ANYHARNESS_BEARER_TOKEN={shlex.quote(anyharness_bearer_token)}",
    ]
    if artifact_base_url:
        env_parts.append(f"PROLIFERATE_ARTIFACT_BASE_URL={shlex.quote(artifact_base_url)}")
    return f"curl -fsSL {shlex.quote(installer_url)} | {' '.join(env_parts)} sh"
