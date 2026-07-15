"""Persistence for integration-gateway tool-call audit events.

One row per ``integrations.call_tool`` proxied through the gateway (success or
failure) so there is queryable evidence a tool call happened and how it went.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudIntegrationToolCallEvent


async def record_tool_call_event(
    db: AsyncSession,
    *,
    user_id: UUID | None,
    organization_id: UUID | None,
    runtime_worker_id: UUID | None,
    integration_namespace: str,
    tool_name: str,
    ok: bool,
    error_code: str | None,
    latency_ms: int,
) -> None:
    """Insert one audit row for a proxied tool call."""
    db.add(
        CloudIntegrationToolCallEvent(
            user_id=user_id,
            organization_id=organization_id,
            runtime_worker_id=runtime_worker_id,
            integration_namespace=integration_namespace,
            tool_name=tool_name,
            ok=ok,
            error_code=error_code,
            latency_ms=latency_ms,
        )
    )
    await db.flush()
