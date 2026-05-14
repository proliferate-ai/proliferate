"""Pure validation and normalization rules for worker payloads."""

from __future__ import annotations

import json

from proliferate.constants.cloud import (
    CLOUD_COMMAND_DEFAULT_LEASE_SECONDS,
    CLOUD_COMMAND_MAX_LEASE_SECONDS,
    PHASE3_CLOUD_COMMAND_KINDS,
    SUPPORTED_CLOUD_WORKER_STATUSES,
    CloudCommandStatus,
    CloudWorkerStatus,
)
from proliferate.server.cloud.errors import CloudApiError

_JSON_FIELD_MAX_BYTES = 256 * 1024


def validate_worker_status(status: str) -> str:
    if status not in SUPPORTED_CLOUD_WORKER_STATUSES:
        raise CloudApiError(
            "cloud_worker_status_invalid",
            "Worker status is invalid.",
            status_code=400,
        )
    if status == CloudWorkerStatus.archived.value:
        raise CloudApiError(
            "cloud_worker_status_reserved",
            "Worker archived status is controlled by the cloud service.",
            status_code=400,
        )
    return status


def compact_json(value: dict[str, object] | None) -> str | None:
    if value is None:
        return None
    serialized = json.dumps(value, separators=(",", ":"), sort_keys=True)
    if len(serialized.encode("utf-8")) > _JSON_FIELD_MAX_BYTES:
        raise CloudApiError(
            "cloud_worker_inventory_too_large",
            "Worker inventory payload is too large.",
            status_code=413,
        )
    return serialized


def normalize_supported_command_kinds(supported_kinds: list[str]) -> tuple[str, ...]:
    if not supported_kinds:
        return PHASE3_CLOUD_COMMAND_KINDS
    filtered = tuple(kind for kind in supported_kinds if kind in PHASE3_CLOUD_COMMAND_KINDS)
    if not filtered:
        raise CloudApiError(
            "cloud_worker_command_kinds_unsupported",
            "Worker did not advertise any supported command kinds.",
            status_code=400,
        )
    return filtered


def clamp_command_lease_seconds(value: int | None) -> int:
    if value is None:
        return CLOUD_COMMAND_DEFAULT_LEASE_SECONDS
    return max(0, min(value, CLOUD_COMMAND_MAX_LEASE_SECONDS))


def validate_delivery_status(status: str) -> str:
    if status == CloudCommandStatus.delivered.value:
        return status
    if status == CloudCommandStatus.failed_delivery.value:
        return status
    raise CloudApiError(
        "cloud_worker_command_delivery_status_invalid",
        "Worker command delivery status is invalid.",
        status_code=400,
    )


def validate_result_status(status: str) -> str:
    if status in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.failed_delivery.value,
    }:
        return status
    raise CloudApiError(
        "cloud_worker_command_result_status_invalid",
        "Worker command result status is invalid.",
        status_code=400,
    )
