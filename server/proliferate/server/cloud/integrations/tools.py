"""Fetch + cache an account's remote MCP tool schema (``tools/list``).

The tool schema for an account is cached in ``cloud_integration_tool_schema_cache``
keyed by ``account_id`` and stamped with the account's ``auth_version``. A ready
cache whose version still matches is served directly; otherwise we resolve
provider access, hit the remote MCP server, and re-cache the result.
"""

from __future__ import annotations

import hashlib
import json
from typing import TYPE_CHECKING, Any

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.integrations.tool_cache import (
    get_tool_cache,
    upsert_tool_cache,
)
from proliferate.integrations import mcp_remote
from proliferate.integrations.mcp_remote import McpRemoteError
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integrations.access import resolve_launch
from proliferate.utils.time import utcnow

if TYPE_CHECKING:
    from proliferate.db.store.integrations.accounts import IntegrationAccountRecord
    from proliferate.db.store.integrations.definitions import IntegrationDefinitionRecord


def _content_hash(tools_json: str) -> str:
    return hashlib.sha256(tools_json.encode("utf-8")).hexdigest()


async def get_or_refresh_tool_cache(
    db: AsyncSession,
    *,
    account_record: IntegrationAccountRecord,
    definition_record: IntegrationDefinitionRecord,
) -> list[dict[str, Any]]:
    """Return the account's tool schema, refreshing the cache when stale.

    Serves a ``ready`` cache whose ``auth_version`` matches the account; else
    fetches ``tools/list`` from the remote MCP server, upserts the cache as
    ``ready``, and returns it. On failure the cache is marked ``error`` and the
    originating error is re-raised.
    """
    cache = await get_tool_cache(db, account_record.id)
    if (
        cache is not None
        and cache.status == "ready"
        and cache.auth_version == account_record.auth_version
    ):
        return _decode_tools(cache.tools_json)

    try:
        url, headers, query = await resolve_launch(db, account_record, definition_record)
        tools = await mcp_remote.list_tools(url=url, headers=headers, query=query or None)
    except (McpRemoteError, CloudApiError) as exc:
        error_code = getattr(exc, "code", None) or "tool_fetch_failed"
        await upsert_tool_cache(
            db,
            account_id=account_record.id,
            auth_version=account_record.auth_version,
            tools_json=cache.tools_json if cache is not None else "[]",
            content_hash=cache.content_hash if cache is not None else None,
            status="error",
            fetched_at=cache.fetched_at if cache is not None else None,
            error_code=str(error_code)[:64],
        )
        raise

    tools_json = json.dumps(tools, separators=(",", ":"))
    await upsert_tool_cache(
        db,
        account_id=account_record.id,
        auth_version=account_record.auth_version,
        tools_json=tools_json,
        content_hash=_content_hash(tools_json),
        status="ready",
        fetched_at=utcnow(),
        error_code=None,
    )
    return tools


def _decode_tools(tools_json: str) -> list[dict[str, Any]]:
    try:
        value = json.loads(tools_json or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(value, list):
        return []
    return [tool for tool in value if isinstance(tool, dict)]
