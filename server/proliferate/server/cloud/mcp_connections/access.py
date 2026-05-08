from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.db.store.cloud_mcp.connections import get_user_connection
from proliferate.db.store.cloud_mcp.types import CloudMcpConnectionRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mcp_connections.domain.connection_rules import (
    McpConnectionRuleViolation,
    validate_connection_id,
)


async def mcp_connection_user_can_manage(
    connection_id: str,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudMcpConnectionRecord:
    try:
        cleaned_connection_id = validate_connection_id(connection_id)
    except McpConnectionRuleViolation as exc:
        raise CloudApiError("invalid_payload", str(exc), status_code=400) from exc
    connection = await get_user_connection(db, user.id, cleaned_connection_id)
    if connection is None:
        raise CloudApiError("not_found", "MCP connection was not found.", status_code=404)
    return connection


McpConnectionManageDependency = Annotated[
    CloudMcpConnectionRecord,
    Depends(mcp_connection_user_can_manage),
]
