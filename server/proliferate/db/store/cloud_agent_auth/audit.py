"""Cloud agent-auth audit store operations."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_auth_router import (
    AgentAuthAuditEvent,
)
from proliferate.db.store.cloud_agent_auth.mappers import (
    _audit_event_record,
)
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthAuditEventRecord,
)
from proliferate.utils.time import utcnow

_UNSET = object()


async def record_audit_event(
    db: AsyncSession,
    *,
    action: str,
    actor_user_id: UUID | None,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    credential_id: UUID | None = None,
    sandbox_profile_id: UUID | None = None,
    target_id: UUID | None = None,
    metadata_json: str = "{}",
) -> AgentAuthAuditEventRecord:
    row = AgentAuthAuditEvent(
        action=action,
        actor_user_id=actor_user_id,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        credential_id=credential_id,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        metadata_json=metadata_json,
        created_at=utcnow(),
    )
    db.add(row)
    await db.flush()
    return _audit_event_record(row)


async def try_acquire_agent_gateway_reconciler_lock(db: AsyncSession) -> bool:
    result = await db.scalar(
        text("SELECT pg_try_advisory_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": "agent_gateway_bifrost_reconciler"},
    )
    return bool(result)


async def release_agent_gateway_reconciler_lock(db: AsyncSession) -> None:
    await db.execute(
        text("SELECT pg_advisory_unlock(hashtextextended(:lock_key, 0))"),
        {"lock_key": "agent_gateway_bifrost_reconciler"},
    )
