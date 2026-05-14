"""Pure rules for cloud compute target operations."""

from __future__ import annotations

from proliferate.constants.cloud import CloudTargetStatus
from proliferate.server.cloud.compute.domain.types import ComputeRuleError, SafeStopVerdict

TERMINAL_SESSION_STATUSES: tuple[str, ...] = (
    "closed",
    "completed",
    "complete",
    "ended",
    "idle",
    "failed",
    "error",
)
ACTIVE_UPDATE_STATUSES: tuple[str, ...] = ("staging", "staged", "applying")

_UPDATE_CHANNEL_MAX_LENGTH = 32
_VERSION_MAX_LENGTH = 128
_SUPPORTED_UPDATE_CHANNELS = frozenset({"stable", "beta", "pinned"})


def normalize_update_channel(value: str | None) -> str:
    channel = (value or "stable").strip().lower()
    if not channel:
        channel = "stable"
    if len(channel) > _UPDATE_CHANNEL_MAX_LENGTH:
        raise ComputeRuleError(
            "cloud_compute_update_channel_too_long",
            "Update channel is too long.",
        )
    if channel not in _SUPPORTED_UPDATE_CHANNELS:
        raise ComputeRuleError(
            "cloud_compute_update_channel_invalid",
            "Update channel is invalid.",
        )
    return channel


def normalize_optional_version(value: str | None) -> str | None:
    if value is None:
        return None
    version = value.strip()
    if not version:
        return None
    if len(version) > _VERSION_MAX_LENGTH:
        raise ComputeRuleError(
            "cloud_compute_update_version_too_long",
            "Update version is too long.",
        )
    if not _is_update_identifier(version):
        raise ComputeRuleError(
            "cloud_compute_update_version_invalid",
            "Update version is invalid.",
        )
    return version


def decide_safe_stop(
    *,
    target_status: str,
    update_status: str | None,
    has_target_safe_stop_state: bool,
    active_session_count: int,
    active_command_count: int,
) -> SafeStopVerdict:
    reasons: list[str] = []
    if target_status == CloudTargetStatus.archived.value:
        reasons.append("target_archived")
    if not has_target_safe_stop_state:
        reasons.append("safe_stop_state_unknown")
    if active_session_count > 0:
        reasons.append("active_sessions")
    if active_command_count > 0:
        reasons.append("active_commands")
    if update_status in ACTIVE_UPDATE_STATUSES:
        reasons.append("update_in_progress")
    return SafeStopVerdict(allowed=not reasons, reasons=tuple(reasons))


def _is_update_identifier(value: str) -> bool:
    return not (
        value in {".", ".."}
        or "/" in value
        or "\\" in value
        or not value
        or not all(
            character.isascii()
            and (character.isalnum() or character in {".", "_", "-", "+"})
            for character in value
        )
    )
