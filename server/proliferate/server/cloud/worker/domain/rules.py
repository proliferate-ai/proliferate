"""Pure validation and normalization rules for worker payloads."""

from __future__ import annotations

import json

from proliferate.constants.cloud import SUPPORTED_CLOUD_WORKER_STATUSES, CloudWorkerStatus
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
