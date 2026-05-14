"""Pure rules for cloud compute target operations."""

from __future__ import annotations

from proliferate.constants.cloud import CloudTargetStatus
from proliferate.server.cloud.compute.domain.types import SafeStopVerdict
from proliferate.server.cloud.errors import CloudApiError

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


def normalize_update_channel(value: str | None) -> str:
    channel = (value or "stable").strip().lower()
    if not channel:
        channel = "stable"
    if len(channel) > _UPDATE_CHANNEL_MAX_LENGTH:
        raise CloudApiError(
            "cloud_compute_update_channel_too_long",
            "Update channel is too long.",
            status_code=400,
        )
    return channel


def normalize_optional_version(value: str | None) -> str | None:
    if value is None:
        return None
    version = value.strip()
    if not version:
        return None
    if len(version) > _VERSION_MAX_LENGTH:
        raise CloudApiError(
            "cloud_compute_update_version_too_long",
            "Update version is too long.",
            status_code=400,
        )
    return version


def decide_safe_stop(
    *,
    target_status: str,
    update_status: str | None,
    active_session_count: int,
    active_command_count: int,
) -> SafeStopVerdict:
    reasons: list[str] = []
    if target_status == CloudTargetStatus.archived.value:
        reasons.append("target_archived")
    if active_session_count > 0:
        reasons.append("active_sessions")
    if active_command_count > 0:
        reasons.append("active_commands")
    if update_status in ACTIVE_UPDATE_STATUSES:
        reasons.append("update_in_progress")
    return SafeStopVerdict(allowed=not reasons, reasons=tuple(reasons))
