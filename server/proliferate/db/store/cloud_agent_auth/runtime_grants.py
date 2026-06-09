"""Cloud agent-auth runtime grants store operations."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_auth_credentials import (
    AgentAuthCredential,
    SandboxAgentAuthSelection,
)
from proliferate.db.models.cloud.agent_auth_gateway import (
    AgentGatewayPolicy,
    AgentGatewayRuntimeGrant,
)
from proliferate.db.models.cloud.agent_auth_profiles import (
    SandboxProfile,
)
from proliferate.db.store.cloud_agent_auth.mappers import (
    _runtime_grant_record,
)
from proliferate.db.store.cloud_agent_auth.records import (
    AgentGatewayRuntimeGrantRecord,
)
from proliferate.utils.time import utcnow

_UNSET = object()


async def create_runtime_grant(
    db: AsyncSession,
    *,
    token_hash: str,
    hash_key_id: str,
    policy_id: UUID,
    credential_id: UUID,
    selection_id: UUID,
    issued_profile_revision: int,
    target_id: UUID,
    sandbox_profile_id: UUID,
    organization_id: UUID | None,
    user_id: UUID | None,
    agent_kind: str,
    auth_slot_id: str,
    protocol_facade: str,
    expires_at: datetime,
) -> AgentGatewayRuntimeGrantRecord:
    now = utcnow()
    row = AgentGatewayRuntimeGrant(
        token_hash=token_hash,
        hash_key_id=hash_key_id,
        policy_id=policy_id,
        credential_id=credential_id,
        selection_id=selection_id,
        issued_profile_revision=issued_profile_revision,
        target_id=target_id,
        sandbox_profile_id=sandbox_profile_id,
        organization_id=organization_id,
        user_id=user_id,
        agent_kind=agent_kind,
        auth_slot_id=auth_slot_id,
        protocol_facade=protocol_facade,
        expires_at=expires_at,
        revoked_at=None,
        last_used_at=None,
        created_at=now,
    )
    db.add(row)
    await db.flush()
    return _runtime_grant_record(row)


async def get_runtime_grant_by_token_hash(
    db: AsyncSession,
    token_hash: str,
) -> AgentGatewayRuntimeGrantRecord | None:
    row = (
        await db.execute(
            select(AgentGatewayRuntimeGrant).where(
                AgentGatewayRuntimeGrant.token_hash == token_hash
            )
        )
    ).scalar_one_or_none()
    return _runtime_grant_record(row) if row is not None else None


async def list_active_runtime_grants_for_route(
    db: AsyncSession,
    *,
    policy_id: UUID,
    target_id: UUID,
    sandbox_profile_id: UUID,
    agent_kind: str,
    auth_slot_id: str,
    now: datetime,
) -> tuple[AgentGatewayRuntimeGrantRecord, ...]:
    rows = (
        (
            await db.execute(
                select(AgentGatewayRuntimeGrant)
                .where(
                    AgentGatewayRuntimeGrant.policy_id == policy_id,
                    AgentGatewayRuntimeGrant.target_id == target_id,
                    AgentGatewayRuntimeGrant.sandbox_profile_id == sandbox_profile_id,
                    AgentGatewayRuntimeGrant.agent_kind == agent_kind,
                    AgentGatewayRuntimeGrant.auth_slot_id == auth_slot_id,
                    AgentGatewayRuntimeGrant.revoked_at.is_(None),
                    AgentGatewayRuntimeGrant.expires_at > now,
                )
                .order_by(AgentGatewayRuntimeGrant.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_runtime_grant_record(row) for row in rows)


async def list_runtime_grants_needing_rotation(
    db: AsyncSession,
    *,
    now: datetime,
    expires_before: datetime,
    limit: int,
) -> tuple[AgentGatewayRuntimeGrantRecord, ...]:
    rows = (
        (
            await db.execute(
                select(AgentGatewayRuntimeGrant)
                .join(
                    SandboxAgentAuthSelection,
                    SandboxAgentAuthSelection.id == AgentGatewayRuntimeGrant.selection_id,
                )
                .join(
                    AgentAuthCredential,
                    AgentAuthCredential.id == AgentGatewayRuntimeGrant.credential_id,
                )
                .join(
                    AgentGatewayPolicy,
                    AgentGatewayPolicy.id == AgentGatewayRuntimeGrant.policy_id,
                )
                .join(
                    SandboxProfile,
                    SandboxProfile.id == AgentGatewayRuntimeGrant.sandbox_profile_id,
                )
                .where(
                    AgentGatewayRuntimeGrant.revoked_at.is_(None),
                    AgentGatewayRuntimeGrant.expires_at > now,
                    AgentGatewayRuntimeGrant.expires_at <= expires_before,
                    SandboxAgentAuthSelection.status == "active",
                    SandboxAgentAuthSelection.selected_revision == AgentAuthCredential.revision,
                    AgentAuthCredential.status == "ready",
                    AgentAuthCredential.revoked_at.is_(None),
                    AgentGatewayPolicy.status == "ready",
                    AgentGatewayPolicy.litellm_sync_status == "synced",
                    SandboxProfile.archived_at.is_(None),
                    SandboxProfile.deleted_at.is_(None),
                )
                .order_by(AgentGatewayRuntimeGrant.expires_at.asc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_runtime_grant_record(row) for row in rows)


async def lock_runtime_grant_route(
    db: AsyncSession,
    *,
    policy_id: UUID,
    target_id: UUID,
    sandbox_profile_id: UUID,
    agent_kind: str,
    auth_slot_id: str,
) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {
            "lock_key": (
                "agent_gateway_runtime_grant:"
                f"{policy_id}:{target_id}:{sandbox_profile_id}:{agent_kind}:{auth_slot_id}"
            )
        },
    )


async def mark_runtime_grant_used(
    db: AsyncSession,
    grant_id: UUID,
) -> AgentGatewayRuntimeGrantRecord | None:
    row = await db.get(AgentGatewayRuntimeGrant, grant_id)
    if row is None:
        return None
    row.last_used_at = utcnow()
    await db.flush()
    return _runtime_grant_record(row)


async def revoke_runtime_grants_for_selection(
    db: AsyncSession,
    *,
    selection_id: UUID,
) -> int:
    rows = (
        (
            await db.execute(
                select(AgentGatewayRuntimeGrant).where(
                    AgentGatewayRuntimeGrant.selection_id == selection_id,
                    AgentGatewayRuntimeGrant.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    now = utcnow()
    for row in rows:
        row.revoked_at = now
    return len(rows)


async def revoke_runtime_grants_by_ids(
    db: AsyncSession,
    grant_ids: set[UUID],
) -> int:
    if not grant_ids:
        return 0
    rows = (
        (
            await db.execute(
                select(AgentGatewayRuntimeGrant).where(
                    AgentGatewayRuntimeGrant.id.in_(grant_ids),
                    AgentGatewayRuntimeGrant.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    now = utcnow()
    for row in rows:
        row.revoked_at = now
    await db.flush()
    return len(rows)


async def revoke_runtime_grants_for_profile_target(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
) -> int:
    rows = (
        (
            await db.execute(
                select(AgentGatewayRuntimeGrant).where(
                    AgentGatewayRuntimeGrant.sandbox_profile_id == sandbox_profile_id,
                    AgentGatewayRuntimeGrant.target_id == target_id,
                    AgentGatewayRuntimeGrant.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    now = utcnow()
    for row in rows:
        row.revoked_at = now
    await db.flush()
    return len(rows)
