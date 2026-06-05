"""Pure serialization helpers for cloud commands."""

from __future__ import annotations

import json

from proliferate.constants.cloud import CLOUD_COMMAND_MAX_PAYLOAD_BYTES
from proliferate.server.cloud.errors import CloudApiError


def compact_command_json(value: dict[str, object] | None) -> str | None:
    if value is None:
        return None
    serialized = json.dumps(value, separators=(",", ":"), sort_keys=True)
    if len(serialized.encode("utf-8")) > CLOUD_COMMAND_MAX_PAYLOAD_BYTES:
        raise CloudApiError(
            "cloud_command_payload_too_large",
            "Cloud command JSON payload must be "
            f"{CLOUD_COMMAND_MAX_PAYLOAD_BYTES} bytes or fewer.",
            status_code=413,
        )
    return serialized
