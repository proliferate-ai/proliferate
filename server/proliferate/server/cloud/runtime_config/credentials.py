from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.integration_gateway.tokens import mint_integration_gateway_grant


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
    if credential_ref.startswith("integration-gateway:"):
        parts = credential_ref.split(":", 2)
        if len(parts) != 3 or parts[2] != "token":
            return None
        try:
            profile_id = UUID(parts[1])
        except ValueError:
            return None
        return await mint_integration_gateway_grant(db, profile_id=profile_id)

    return None
