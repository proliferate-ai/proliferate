"""Persistence helpers for integration accounts.

An account is a user's authenticated instance of an integration definition
(credential bundle + status), one row per (owner_user_id, definition_id).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

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


async def list_ready_accounts_for_user(
    db: AsyncSession,
    user_id: UUID,
    *,
    organization_id: UUID | None = None,
) -> tuple[IntegrationAccountRecord, ...]:
    """The user's enabled, ready accounts (non-archived definitions).

    When ``organization_id`` is given the org's integration policy is enforced —
    an account is excluded when the org has disabled that definition (a policy row
    with ``enabled = false``, or no policy row and the definition is not
    ``enabled_by_default``). This mirrors ``get_ready_account_for_provider`` so a
    personally-connected account cannot bypass an org's disable decision. Callers
    with a real org context (e.g. the integration gateway) MUST pass it.
    """
    stmt = (
        select(CloudIntegrationAccount)
        .join(
            CloudIntegrationDefinition,
            CloudIntegrationDefinition.id == CloudIntegrationAccount.definition_id,
        )
        .where(
            CloudIntegrationAccount.owner_user_id == user_id,
            CloudIntegrationAccount.enabled.is_(True),
            CloudIntegrationAccount.status == "ready",
            CloudIntegrationDefinition.archived_at.is_(None),
        )
    )
    if organization_id is not None:
        stmt = stmt.outerjoin(
            CloudIntegrationPolicy,
            (CloudIntegrationPolicy.definition_id == CloudIntegrationDefinition.id)
            & (CloudIntegrationPolicy.organization_id == organization_id),
        ).where(
            func.coalesce(
                CloudIntegrationPolicy.enabled,
                CloudIntegrationDefinition.enabled_by_default,
            ).is_(True)
        )
    accounts = (
        (await db.execute(stmt.order_by(CloudIntegrationAccount.created_at.asc())))
        .scalars()
        .all()
    )
    return tuple(_record(account) for account in accounts)


async def get_ready_account_for_provider(
    db: AsyncSession,
    user_id: UUID,
    namespace: str,
    *,
    organization_id: UUID | None = None,
) -> tuple[IntegrationAccountRecord, definitions_store.IntegrationDefinitionRecord] | None:
    """The user's enabled, ready account whose non-archived definition matches ``namespace``.

    When ``organization_id`` is given the org's integration policy is enforced:
    an account is excluded when the org has disabled that definition (a policy
    row with ``enabled = false``, or no policy row and the definition is not
    ``enabled_by_default``). Callers with a real org context must pass it so a
    personally-connected account cannot bypass an org's disable decision.
    """
    stmt = (
        select(CloudIntegrationAccount, CloudIntegrationDefinition)
        .join(
            CloudIntegrationDefinition,
            CloudIntegrationDefinition.id == CloudIntegrationAccount.definition_id,
        )
        .where(
            CloudIntegrationAccount.owner_user_id == user_id,
            CloudIntegrationAccount.enabled.is_(True),
            CloudIntegrationAccount.status == "ready",
            CloudIntegrationDefinition.namespace == namespace,
            CloudIntegrationDefinition.archived_at.is_(None),
        )
    )
    if organization_id is not None:
        # LEFT JOIN the org's policy row for this definition; enabled state is the
        # policy's when present, else the definition's default. Disabled => excluded.
        stmt = stmt.outerjoin(
            CloudIntegrationPolicy,
            (CloudIntegrationPolicy.definition_id == CloudIntegrationDefinition.id)
            & (CloudIntegrationPolicy.organization_id == organization_id),
        ).where(
            func.coalesce(
                CloudIntegrationPolicy.enabled,
                CloudIntegrationDefinition.enabled_by_default,
            ).is_(True)
        )
    row = (
        await db.execute(
            stmt.order_by(CloudIntegrationAccount.created_at.asc()).limit(1)
        )
    ).first()
    if row is None:
        return None
    account, definition = row
    return _record(account), definitions_store._record(definition)


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
