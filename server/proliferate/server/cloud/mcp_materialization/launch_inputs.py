from __future__ import annotations

from typing import Literal

from proliferate.db.store.cloud_mcp.types import CloudMcpConnectionRecord
from proliferate.server.cloud.mcp_catalog.domain.rendering import (
    parse_settings,
    validate_secret_fields,
    validate_settings,
)
from proliferate.server.cloud.mcp_catalog.domain.types import (
    CatalogConfigurationError,
    CatalogEntry,
)
from proliferate.utils.crypto import decrypt_json


def settings_for_record(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
) -> dict[str, object]:
    return validate_settings(entry, parse_settings(record.settings_json))


def secret_fields_for_record(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
) -> dict[str, str] | None:
    if (
        record.auth is None
        or record.auth.auth_status != "ready"
        or not record.auth.payload_ciphertext
    ):
        return None
    payload = decrypt_json(record.auth.payload_ciphertext)
    secret_fields = payload.get("secretFields")
    if not isinstance(secret_fields, dict):
        return None
    try:
        return validate_secret_fields(
            entry,
            {str(key): str(value) for key, value in secret_fields.items()},
        )
    except CatalogConfigurationError:
        return None


def launch_context(
    target_location: Literal["local", "cloud"],
) -> Literal["local_materialization", "cloud_materialization"]:
    return "local_materialization" if target_location == "local" else "cloud_materialization"
