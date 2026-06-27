from __future__ import annotations

import hashlib
import json

from proliferate.db.store.cloud_integrations.types import (
    IntegrationAccountRecord,
    IntegrationDefinitionRecord,
)
from proliferate.server.cloud.integrations.domain.catalog_schema import (
    parse_definition_config,
    render_mcp_url,
)


def tool_schema_cache_key(
    *,
    account: IntegrationAccountRecord,
    definition: IntegrationDefinitionRecord,
) -> str:
    config = parse_definition_config(definition.config_json)
    settings = _json_object(account.settings_json)
    payload = {
        "definitionId": str(definition.id),
        "definitionHash": definition.content_hash,
        "accountId": str(account.id),
        "authVersion": account.auth_version,
        "settings": settings,
        "mcpUrl": render_mcp_url(config, settings),
    }
    raw = json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    return f"sha256:{hashlib.sha256(raw.encode('utf-8')).hexdigest()}"


def _json_object(value: str) -> dict[str, object]:
    try:
        parsed = json.loads(value or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}
