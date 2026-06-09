"""Cloud agent-auth selections store operations."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_auth_credentials import (
    AgentAuthCredential,
    SandboxAgentAuthSelection,
)
from proliferate.db.models.cloud.agent_auth_profiles import (
    SandboxProfile,
)
from proliferate.db.store.cloud_agent_auth.mappers import (
    _credential_record,
    _selection_record,
)
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialRecord,
    SandboxAgentAuthSelectionRecord,
)
from proliferate.utils.time import utcnow

_UNSET = object()


async def list_selections_for_profile(
    db: AsyncSession,
    sandbox_profile_id: UUID,
) -> tuple[SandboxAgentAuthSelectionRecord, ...]:
    rows = (
        (
            await db.execute(
                select(SandboxAgentAuthSelection)
                .where(SandboxAgentAuthSelection.sandbox_profile_id == sandbox_profile_id)
                .order_by(
                    SandboxAgentAuthSelection.agent_kind.asc(),
                    SandboxAgentAuthSelection.auth_slot_id.asc(),
                )
            )
        )
        .scalars()
        .all()
    )
    return tuple(_selection_record(row) for row in rows)


async def list_selected_personal_synced_credentials_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> tuple[AgentAuthCredentialRecord, ...]:
    rows = (
        (
            await db.execute(
                select(AgentAuthCredential)
                .join(
                    SandboxAgentAuthSelection,
                    SandboxAgentAuthSelection.credential_id == AgentAuthCredential.id,
                )
                .join(
                    SandboxProfile,
                    SandboxProfile.id == SandboxAgentAuthSelection.sandbox_profile_id,
                )
                .where(
                    SandboxProfile.owner_scope == "personal",
                    SandboxProfile.owner_user_id == user_id,
                    SandboxProfile.archived_at.is_(None),
                    AgentAuthCredential.owner_scope == "personal",
                    AgentAuthCredential.owner_user_id == user_id,
                    AgentAuthCredential.credential_kind == "synced_path",
                    AgentAuthCredential.status == "ready",
                    AgentAuthCredential.revoked_at.is_(None),
                    SandboxAgentAuthSelection.status == "active",
                    SandboxAgentAuthSelection.materialization_mode == "synced_files",
                    SandboxAgentAuthSelection.selected_revision == AgentAuthCredential.revision,
                )
                .order_by(AgentAuthCredential.credential_provider_id.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_credential_record(row) for row in rows)


async def upsert_selection(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    owner_scope: str,
    agent_kind: str,
    auth_slot_id: str,
    credential_id: UUID,
    credential_share_id: UUID | None,
    materialization_mode: str,
    selected_revision: int,
    status: str,
    last_error_code: str | None,
    last_error_message: str | None,
) -> SandboxAgentAuthSelectionRecord:
    row = (
        await db.execute(
            select(SandboxAgentAuthSelection)
            .where(
                SandboxAgentAuthSelection.sandbox_profile_id == sandbox_profile_id,
                SandboxAgentAuthSelection.agent_kind == agent_kind,
                SandboxAgentAuthSelection.auth_slot_id == auth_slot_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = SandboxAgentAuthSelection(
            sandbox_profile_id=sandbox_profile_id,
            owner_scope=owner_scope,
            agent_kind=agent_kind,
            auth_slot_id=auth_slot_id,
            credential_id=credential_id,
            credential_share_id=credential_share_id,
            materialization_mode=materialization_mode,
            selected_revision=selected_revision,
            status=status,
            last_error_code=last_error_code,
            last_error_message=last_error_message,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.owner_scope = owner_scope
        row.credential_id = credential_id
        row.credential_share_id = credential_share_id
        row.materialization_mode = materialization_mode
        row.selected_revision = selected_revision
        row.status = status
        row.last_error_code = last_error_code
        row.last_error_message = last_error_message
        row.updated_at = now
    await db.flush()
    return _selection_record(row)


async def mark_selection_invalid(
    db: AsyncSession,
    *,
    selection_id: UUID,
    error_code: str,
    error_message: str,
) -> SandboxAgentAuthSelectionRecord | None:
    row = await db.get(SandboxAgentAuthSelection, selection_id)
    if row is None:
        return None
    row.status = "invalid"
    row.last_error_code = error_code
    row.last_error_message = error_message
    row.updated_at = utcnow()
    await db.flush()
    return _selection_record(row)
