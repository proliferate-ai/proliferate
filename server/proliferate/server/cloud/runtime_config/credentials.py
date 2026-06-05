from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_mcp import auth as mcp_auth_store
from proliferate.server.cloud.runtime_config.domain.credentials import (
    credential_value_from_payload,
)
from proliferate.utils.crypto import decrypt_json


def credential_refs_from_manifest(manifest: dict[str, object]) -> list[dict[str, object]]:
    refs: list[dict[str, object]] = []
    servers = manifest.get("mcpServers")
    if not isinstance(servers, list):
        return refs
    for server in servers:
        if not isinstance(server, dict):
            continue
        server_refs = server.get("credentialRefs")
        if isinstance(server_refs, list):
            refs.extend(item for item in server_refs if isinstance(item, dict))
    return refs


async def resolve_runtime_credential_ref(
    db: AsyncSession,
    credential_ref: str,
) -> str | None:
    parts = credential_ref.split(":", 2)
    if len(parts) != 3 or parts[0] != "mcp":
        return None
    try:
        connection_db_id = UUID(parts[1])
    except ValueError:
        return None
    field_name = parts[2]
    auth = await mcp_auth_store.load_connection_auth(
        db,
        connection_db_id=connection_db_id,
    )
    if auth is not None and auth.auth_status == "ready" and auth.payload_ciphertext:
        payload = decrypt_json(auth.payload_ciphertext)
    else:
        return None
    if not isinstance(payload, dict):
        return None
    return credential_value_from_payload(payload, field_name)
