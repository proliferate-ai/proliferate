"""Cloud agent-auth shares store operations."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_auth_credentials import (
    AgentAuthCredentialShare,
    SandboxAgentAuthSelection,
)
from proliferate.db.store.cloud_agent_auth.mappers import (
    _selection_record,
    _share_record,
)
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialShareRecord,
    SandboxAgentAuthSelectionRecord,
)
from proliferate.utils.time import utcnow

_UNSET = object()


async def create_or_reactivate_credential_share(
    db: AsyncSession,
    *,
    credential_id: UUID,
    owner_user_id: UUID,
    organization_id: UUID,
    shared_by_user_id: UUID,
    allowed_agent_kind: str,
) -> AgentAuthCredentialShareRecord:
    row = (
        await db.execute(
            select(AgentAuthCredentialShare)
            .where(
                AgentAuthCredentialShare.credential_id == credential_id,
                AgentAuthCredentialShare.organization_id == organization_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = AgentAuthCredentialShare(
            credential_id=credential_id,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            share_scope="organization",
            shared_by_user_id=shared_by_user_id,
            status="active",
            allowed_agent_kind=allowed_agent_kind,
            created_at=now,
            revoked_at=None,
            revoked_by_user_id=None,
        )
        db.add(row)
    else:
        row.status = "active"
        row.allowed_agent_kind = allowed_agent_kind
        row.revoked_at = None
        row.revoked_by_user_id = None
    await db.flush()
    return _share_record(row)


async def get_active_credential_share(
    db: AsyncSession,
    *,
    credential_id: UUID,
    organization_id: UUID,
) -> AgentAuthCredentialShareRecord | None:
    row = (
        await db.execute(
            select(AgentAuthCredentialShare).where(
                AgentAuthCredentialShare.credential_id == credential_id,
                AgentAuthCredentialShare.organization_id == organization_id,
                AgentAuthCredentialShare.status == "active",
            )
        )
    ).scalar_one_or_none()
    return _share_record(row) if row is not None else None


async def get_credential_share(
    db: AsyncSession,
    share_id: UUID,
) -> AgentAuthCredentialShareRecord | None:
    row = await db.get(AgentAuthCredentialShare, share_id)
    return _share_record(row) if row is not None else None


async def revoke_credential_share(
    db: AsyncSession,
    *,
    share_id: UUID,
    revoked_by_user_id: UUID,
) -> AgentAuthCredentialShareRecord | None:
    row = (
        await db.execute(
            select(AgentAuthCredentialShare)
            .where(AgentAuthCredentialShare.id == share_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.status = "revoked"
    row.revoked_at = utcnow()
    row.revoked_by_user_id = revoked_by_user_id
    await db.flush()
    return _share_record(row)


async def list_active_selections_for_credential_or_share(
    db: AsyncSession,
    *,
    credential_id: UUID | None = None,
    credential_share_id: UUID | None = None,
) -> tuple[SandboxAgentAuthSelectionRecord, ...]:
    filters = [SandboxAgentAuthSelection.status == "active"]
    if credential_id is not None:
        filters.append(SandboxAgentAuthSelection.credential_id == credential_id)
    if credential_share_id is not None:
        filters.append(SandboxAgentAuthSelection.credential_share_id == credential_share_id)
    rows = (await db.execute(select(SandboxAgentAuthSelection).where(*filters))).scalars().all()
    return tuple(_selection_record(row) for row in rows)
