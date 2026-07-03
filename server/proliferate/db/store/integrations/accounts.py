"""Persistence helpers for integration accounts.

An account is a user's authenticated instance of an integration definition
(credential bundle + status), one row per (owner_user_id, definition_id).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import Row, and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from proliferate.db.models.cloud.integrations import (
    CloudIntegrationAccount,
    CloudIntegrationDefinition,
    CloudIntegrationPolicy,
)
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class IntegrationAccountRecord:
    id: UUID
    definition_id: UUID
    owner_user_id: UUID
    owner_scope: str
    enabled: bool
    status: str
    auth_kind: str
    credential_ciphertext: str | None
    credential_format: str
    auth_version: int
    settings_json: str
    token_expires_at: datetime | None
    last_error_code: str | None
    created_at: datetime
    updated_at: datetime


def _record(account: CloudIntegrationAccount) -> IntegrationAccountRecord:
    return IntegrationAccountRecord(
        id=account.id,
        definition_id=account.definition_id,
        owner_user_id=account.owner_user_id,
        owner_scope=account.owner_scope,
        enabled=account.enabled,
        status=account.status,
        auth_kind=account.auth_kind,
        credential_ciphertext=account.credential_ciphertext,
        credential_format=account.credential_format,
        auth_version=account.auth_version,
        settings_json=account.settings_json,
        token_expires_at=account.token_expires_at,
        last_error_code=account.last_error_code,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


async def get_account(
    db: AsyncSession,
    account_id: UUID,
) -> IntegrationAccountRecord | None:
    account = (
        await db.execute(
            select(CloudIntegrationAccount).where(CloudIntegrationAccount.id == account_id)
        )
    ).scalar_one_or_none()
    return _record(account) if account is not None else None


async def get_account_for_user_definition(
    db: AsyncSession,
    user_id: UUID,
    definition_id: UUID,
) -> IntegrationAccountRecord | None:
    account = (
        await db.execute(
            select(CloudIntegrationAccount).where(
                CloudIntegrationAccount.owner_user_id == user_id,
                CloudIntegrationAccount.definition_id == definition_id,
            )
        )
    ).scalar_one_or_none()
    return _record(account) if account is not None else None


async def list_accounts_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> tuple[IntegrationAccountRecord, ...]:
    accounts = (
        (
            await db.execute(
                select(CloudIntegrationAccount)
                .where(CloudIntegrationAccount.owner_user_id == user_id)
                .order_by(CloudIntegrationAccount.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_record(account) for account in accounts)


@dataclass(frozen=True)
class ReadyAccountRow:
    """A ready account joined with its definition and (optionally) org policy.

    ``org_policy_enabled`` is the org's policy verdict for the definition, or
    ``None`` when the org has no policy row (or no org scope was requested).
    """

    account: IntegrationAccountRecord
    definition: definitions_store.IntegrationDefinitionRecord
    org_policy_enabled: bool | None


def _ready_accounts_stmt(user_id: UUID, organization_id: UUID | None) -> Select:
    """Ready accounts + non-archived definitions, LEFT JOINed to the org policy.

    The policy overlay joins in the same query (one round-trip, no
    per-definition lookups); without an org there is no policy join at all.
    """
    stmt = select(CloudIntegrationAccount, CloudIntegrationDefinition).join(
        CloudIntegrationDefinition,
        CloudIntegrationDefinition.id == CloudIntegrationAccount.definition_id,
    )
    if organization_id is not None:
        stmt = stmt.add_columns(CloudIntegrationPolicy.enabled).outerjoin(
            CloudIntegrationPolicy,
            and_(
                CloudIntegrationPolicy.definition_id == CloudIntegrationAccount.definition_id,
                CloudIntegrationPolicy.organization_id == organization_id,
            ),
        )
    return stmt.where(
        CloudIntegrationAccount.owner_user_id == user_id,
        CloudIntegrationAccount.enabled.is_(True),
        CloudIntegrationAccount.status == "ready",
        CloudIntegrationDefinition.archived_at.is_(None),
        # Definition visibility mirrors the admin API: seeds are global,
        # org_custom definitions are served only under their owning org's
        # scope (for org-less requests this collapses to seeds only). Without
        # this, an org-B-scoped grant would expose the user's accounts on org
        # A's custom definitions — which org B's admins can neither see nor
        # policy-control — and provider-name resolution could land on another
        # org's custom definition that shares a seed namespace.
        or_(
            CloudIntegrationDefinition.organization_id.is_(None),
            CloudIntegrationDefinition.organization_id == organization_id,
        ),
    ).order_by(CloudIntegrationAccount.created_at.asc())


def _ready_account_row(row: Row, organization_id: UUID | None) -> ReadyAccountRow:
    return ReadyAccountRow(
        account=_record(row[0]),
        definition=definitions_store.record_from_row(row[1]),
        org_policy_enabled=row[2] if organization_id is not None else None,
    )


async def list_ready_accounts_for_user(
    db: AsyncSession,
    user_id: UUID,
    *,
    organization_id: UUID | None = None,
) -> tuple[ReadyAccountRow, ...]:
    """The user's enabled, ready accounts with non-archived definitions."""
    rows = (await db.execute(_ready_accounts_stmt(user_id, organization_id))).all()
    return tuple(_ready_account_row(row, organization_id) for row in rows)


async def get_ready_account_for_provider(
    db: AsyncSession,
    user_id: UUID,
    namespace: str,
    *,
    organization_id: UUID | None = None,
) -> ReadyAccountRow | None:
    """The user's enabled, ready account whose non-archived definition matches ``namespace``."""
    row = (
        await db.execute(
            _ready_accounts_stmt(user_id, organization_id)
            .where(CloudIntegrationDefinition.namespace == namespace)
            .limit(1)
        )
    ).first()
    return _ready_account_row(row, organization_id) if row is not None else None


async def upsert_account(
    db: AsyncSession,
    *,
    user_id: UUID,
    definition_id: UUID,
    auth_kind: str,
    status: str,
    enabled: bool = True,
) -> IntegrationAccountRecord:
    account = (
        await db.execute(
            select(CloudIntegrationAccount)
            .where(
                CloudIntegrationAccount.owner_user_id == user_id,
                CloudIntegrationAccount.definition_id == definition_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if account is None:
        account = CloudIntegrationAccount(
            definition_id=definition_id,
            owner_user_id=user_id,
            owner_scope="personal",
            enabled=enabled,
            status=status,
            auth_kind=auth_kind,
            created_at=now,
            updated_at=now,
        )
        db.add(account)
    else:
        account.auth_kind = auth_kind
        account.status = status
        account.enabled = enabled
        account.updated_at = now
    await db.flush()
    await db.refresh(account)
    return _record(account)


async def set_account_credentials(
    db: AsyncSession,
    *,
    account_id: UUID,
    credential_ciphertext: str | None,
    credential_format: str,
    auth_status: str,
    token_expires_at: datetime | None,
    expected_auth_version: int | None = None,
) -> IntegrationAccountRecord | None:
    account = (
        await db.execute(
            select(CloudIntegrationAccount)
            .where(CloudIntegrationAccount.id == account_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if account is None:
        return None
    # Optimistic concurrency: bail if another writer moved the version.
    if expected_auth_version is not None and account.auth_version != expected_auth_version:
        return None
    now = utcnow()
    account.credential_ciphertext = credential_ciphertext
    account.credential_format = credential_format
    account.status = auth_status
    account.token_expires_at = token_expires_at
    account.auth_version = account.auth_version + 1
    account.last_error_code = None
    account.updated_at = now
    await db.flush()
    await db.refresh(account)
    return _record(account)


async def set_account_status(
    db: AsyncSession,
    account_id: UUID,
    status: str,
    last_error_code: str | None = None,
) -> IntegrationAccountRecord | None:
    account = (
        await db.execute(
            select(CloudIntegrationAccount)
            .where(CloudIntegrationAccount.id == account_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if account is None:
        return None
    account.status = status
    account.last_error_code = last_error_code
    account.updated_at = utcnow()
    await db.flush()
    await db.refresh(account)
    return _record(account)


async def set_account_settings(
    db: AsyncSession,
    account_id: UUID,
    settings_json: str,
) -> IntegrationAccountRecord | None:
    account = (
        await db.execute(
            select(CloudIntegrationAccount)
            .where(CloudIntegrationAccount.id == account_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if account is None:
        return None
    account.settings_json = settings_json
    account.updated_at = utcnow()
    await db.flush()
    await db.refresh(account)
    return _record(account)


async def delete_account(
    db: AsyncSession,
    account_id: UUID,
) -> None:
    await db.execute(
        delete(CloudIntegrationAccount).where(CloudIntegrationAccount.id == account_id)
    )
    await db.flush()
