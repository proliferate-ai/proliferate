"""Worker update lifecycle rules."""

from __future__ import annotations

from dataclasses import dataclass

from proliferate.constants.cloud import CloudTargetUpdateStatus
from proliferate.server.cloud.errors import CloudApiError

ACTIVE_TARGET_UPDATE_STATUSES = frozenset(
    {
        CloudTargetUpdateStatus.staging.value,
        CloudTargetUpdateStatus.staged.value,
        CloudTargetUpdateStatus.applying.value,
    }
)


@dataclass(frozen=True)
class DesiredVersions:
    anyharness_version: str | None
    worker_version: str | None
    supervisor_version: str | None


def has_desired_versions(versions: DesiredVersions) -> bool:
    return any(
        version is not None
        for version in (
            versions.anyharness_version,
            versions.worker_version,
            versions.supervisor_version,
        )
    )


def desired_versions_match(
    *,
    desired: DesiredVersions,
    current: DesiredVersions | None,
) -> bool:
    if current is None or not has_desired_versions(desired):
        return False
    desired_and_current = (
        (desired.anyharness_version, current.anyharness_version),
        (desired.worker_version, current.worker_version),
        (desired.supervisor_version, current.supervisor_version),
    )
    return all(
        desired_version is None or desired_version == current_version
        for desired_version, current_version in desired_and_current
    )


def desired_version_for_component(
    *,
    desired: DesiredVersions,
    component: str,
) -> str | None:
    if component == "anyharness":
        return desired.anyharness_version
    if component == "worker":
        return desired.worker_version
    if component == "supervisor":
        return desired.supervisor_version
    return None


def require_expected_update_version(
    *,
    desired: DesiredVersions,
    current_update_generation: int,
    update_generation: int | None,
    status_value: str,
    component: str | None,
    version: str | None,
) -> None:
    if update_generation is None:
        raise CloudApiError(
            "cloud_worker_update_generation_required",
            "Worker update generation is required for update status reports.",
            status_code=400,
        )
    if update_generation != current_update_generation:
        raise CloudApiError(
            "cloud_worker_update_generation_stale",
            "Worker update generation does not match the target desired versions.",
            status_code=409,
        )
    if status_value not in {
        CloudTargetUpdateStatus.staged.value,
        CloudTargetUpdateStatus.applying.value,
        CloudTargetUpdateStatus.applied.value,
    }:
        return
    if component is None or version is None:
        raise CloudApiError(
            "cloud_worker_update_component_required",
            "Worker update component and version are required for this update status.",
            status_code=400,
        )
    desired_version = desired_version_for_component(desired=desired, component=component)
    if desired_version != version:
        raise CloudApiError(
            "cloud_worker_update_version_stale",
            "Worker update version does not match the target desired version.",
            status_code=409,
        )
