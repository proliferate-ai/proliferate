"""Cloud agent-auth credentials store operations."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_auth_credentials import (
    AgentAuthCredential,
    AgentAuthCredentialShare,
    SandboxAgentAuthSelection,
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


async def list_visible_credentials(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID | None = None,
    credential_provider_id: str | None = None,
) -> tuple[AgentAuthCredentialRecord, ...]:
    filters = [
        AgentAuthCredential.revoked_at.is_(None),
        AgentAuthCredential.status != "revoked",
    ]
    if credential_provider_id is not None:
        filters.append(AgentAuthCredential.credential_provider_id == credential_provider_id)
    visibility = [
        AgentAuthCredential.owner_scope == "system",
        and_(
            AgentAuthCredential.owner_scope == "personal",
            AgentAuthCredential.owner_user_id == actor_user_id,
        ),
    ]
    if organization_id is not None:
        visibility.append(
            and_(
                AgentAuthCredential.owner_scope == "organization",
                AgentAuthCredential.organization_id == organization_id,
            )
        )
        shared_credential_ids = select(AgentAuthCredentialShare.credential_id).where(
            AgentAuthCredentialShare.organization_id == organization_id,
            AgentAuthCredentialShare.status == "active",
        )
        visibility.append(AgentAuthCredential.id.in_(shared_credential_ids))
    rows = (
        (
            await db.execute(
                select(AgentAuthCredential)
                .where(*filters, or_(*visibility))
                .order_by(
                    AgentAuthCredential.credential_provider_id.asc(),
                    AgentAuthCredential.owner_scope.asc(),
                    AgentAuthCredential.display_name.asc(),
                )
            )
        )
        .scalars()
        .all()
    )
    return tuple(_credential_record(row) for row in rows)


async def get_credential(
    db: AsyncSession,
    credential_id: UUID,
) -> AgentAuthCredentialRecord | None:
    row = await db.get(AgentAuthCredential, credential_id)
    if row is None:
        return None
    return _credential_record(row)


async def get_selection(
    db: AsyncSession,
    selection_id: UUID,
) -> SandboxAgentAuthSelectionRecord | None:
    row = await db.get(SandboxAgentAuthSelection, selection_id)
    return _selection_record(row) if row is not None else None


async def get_credential_for_update(
    db: AsyncSession,
    credential_id: UUID,
) -> AgentAuthCredentialRecord | None:
    row = (
        await db.execute(
            select(AgentAuthCredential)
            .where(AgentAuthCredential.id == credential_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return _credential_record(row)


async def create_agent_auth_credential(
    db: AsyncSession,
    *,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    created_by_user_id: UUID | None,
    credential_provider_id: str,
    credential_kind: str,
    display_name: str,
    redacted_summary_json: str,
    status: str,
    payload_ciphertext: str | None = None,
    payload_ciphertext_key_id: str | None = None,
) -> AgentAuthCredentialRecord:
    now = utcnow()
    row = AgentAuthCredential(
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
        credential_provider_id=credential_provider_id,
        credential_kind=credential_kind,
        display_name=display_name,
        redacted_summary_json=redacted_summary_json,
        status=status,
        revision=1,
        payload_ciphertext=payload_ciphertext,
        payload_ciphertext_key_id=payload_ciphertext_key_id,
        created_at=now,
        updated_at=now,
        revoked_at=None,
    )
    db.add(row)
    await db.flush()
    return _credential_record(row)


async def update_credential_status(
    db: AsyncSession,
    *,
    credential_id: UUID,
    status: str,
    redacted_summary_json: str | None = None,
) -> AgentAuthCredentialRecord | None:
    row = await db.get(AgentAuthCredential, credential_id)
    if row is None:
        return None
    row.status = status
    row.revision += 1
    row.updated_at = utcnow()
    if redacted_summary_json is not None:
        row.redacted_summary_json = redacted_summary_json
    await db.flush()
    return _credential_record(row)


async def revoke_credential(
    db: AsyncSession,
    *,
    credential_id: UUID,
) -> AgentAuthCredentialRecord | None:
    row = (
        await db.execute(
            select(AgentAuthCredential)
            .where(AgentAuthCredential.id == credential_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    now = utcnow()
    row.status = "revoked"
    row.revoked_at = now
    row.updated_at = now
    row.revision += 1
    await db.flush()
    return _credential_record(row)


async def get_active_personal_synced_credential_for_update(
    db: AsyncSession,
    *,
    user_id: UUID,
    credential_provider_id: str,
) -> AgentAuthCredentialRecord | None:
    row = (
        (
            await db.execute(
                select(AgentAuthCredential)
                .where(
                    AgentAuthCredential.owner_scope == "personal",
                    AgentAuthCredential.owner_user_id == user_id,
                    AgentAuthCredential.organization_id.is_(None),
                    AgentAuthCredential.credential_provider_id == credential_provider_id,
                    AgentAuthCredential.credential_kind == "synced_path",
                    AgentAuthCredential.revoked_at.is_(None),
                    AgentAuthCredential.status != "revoked",
                )
                .order_by(AgentAuthCredential.created_at.asc())
                .with_for_update()
            )
        )
        .scalars()
        .first()
    )
    return _credential_record(row) if row is not None else None


async def update_synced_credential_payload(
    db: AsyncSession,
    *,
    credential_id: UUID,
    display_name: str,
    redacted_summary_json: str,
    payload_ciphertext: str,
    payload_ciphertext_key_id: str,
    status: str,
    increment_revision: bool,
) -> AgentAuthCredentialRecord | None:
    row = await db.get(AgentAuthCredential, credential_id)
    if row is None:
        return None
    row.display_name = display_name
    row.redacted_summary_json = redacted_summary_json
    row.payload_ciphertext = payload_ciphertext
    row.payload_ciphertext_key_id = payload_ciphertext_key_id
    row.status = status
    if increment_revision:
        row.revision += 1
    row.updated_at = utcnow()
    await db.flush()
    return _credential_record(row)
