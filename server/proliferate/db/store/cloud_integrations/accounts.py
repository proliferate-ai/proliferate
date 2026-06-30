from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import (
    CloudIntegrationAccount,
    CloudIntegrationDefinition,
)
from proliferate.db.store.cloud_integrations.definitions import _definition_record
from proliferate.db.store.cloud_integrations.types import (
    IntegrationAccountRecord,
    IntegrationAccountWithDefinitionRecord,
)
from proliferate.utils.time import utcnow

_UNSET = object()


def _account_record(row: CloudIntegrationAccount) -> IntegrationAccountRecord:
    return IntegrationAccountRecord(
        id=row.id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        definition_id=row.definition_id,
        auth_kind=row.auth_kind,
        status=row.status,
        settings_json=row.settings_json,
        credential_ciphertext=row.credential_ciphertext,
        auth_version=row.auth_version,
        token_expires_at=row.token_expires_at,
        last_error_code=row.last_error_code,
        enabled=row.enabled,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _account_with_definition_record(
    account: CloudIntegrationAccount,
    definition: CloudIntegrationDefinition,
) -> IntegrationAccountWithDefinitionRecord:
    return IntegrationAccountWithDefinitionRecord(
        account=_account_record(account),
        definition=_definition_record(definition),
    )


async def list_accounts_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> tuple[IntegrationAccountWithDefinitionRecord, ...]:
    rows = (
        await db.execute(
            select(CloudIntegrationAccount, CloudIntegrationDefinition)
            .join(
                CloudIntegrationDefinition,
                CloudIntegrationDefinition.id == CloudIntegrationAccount.definition_id,
            )
            .where(
                CloudIntegrationAccount.owner_scope == "personal",
                CloudIntegrationAccount.owner_user_id == user_id,
            )
            .order_by(CloudIntegrationDefinition.display_name.asc())
        )
    ).all()
    return tuple(_account_with_definition_record(account, definition) for account, definition in rows)


async def list_ready_accounts_for_personal_profile(
    db: AsyncSession,
    user_id: UUID,
) -> tuple[IntegrationAccountWithDefinitionRecord, ...]:
    rows = (
        await db.execute(
            select(CloudIntegrationAccount, CloudIntegrationDefinition)
            .join(
                CloudIntegrationDefinition,
                CloudIntegrationDefinition.id == CloudIntegrationAccount.definition_id,
            )
            .where(
                CloudIntegrationAccount.owner_scope == "personal",
                CloudIntegrationAccount.owner_user_id == user_id,
                CloudIntegrationAccount.enabled.is_(True),
                CloudIntegrationAccount.status == "ready",
                CloudIntegrationDefinition.archived_at.is_(None),
            )
            .order_by(CloudIntegrationDefinition.namespace.asc())
        )
    ).all()
    return tuple(_account_with_definition_record(account, definition) for account, definition in rows)


async def list_ready_accounts_for_organization_profile(
    db: AsyncSession,
    organization_id: UUID,
) -> tuple[IntegrationAccountWithDefinitionRecord, ...]:
    rows = (
        await db.execute(
            select(CloudIntegrationAccount, CloudIntegrationDefinition)
            .join(
                CloudIntegrationDefinition,
                CloudIntegrationDefinition.id == CloudIntegrationAccount.definition_id,
            )
            .where(
                CloudIntegrationAccount.enabled.is_(True),
                CloudIntegrationAccount.status == "ready",
                CloudIntegrationDefinition.archived_at.is_(None),
                or_(
                    (
                        (CloudIntegrationAccount.owner_scope == "organization")
                        & (CloudIntegrationAccount.organization_id == organization_id)
                    ),
                    (
                        (CloudIntegrationAccount.owner_scope == "personal")
                        & (CloudIntegrationDefinition.source == "seed")
                    ),
                ),
            )
            .order_by(CloudIntegrationDefinition.namespace.asc())
        )
    ).all()
    return tuple(_account_with_definition_record(account, definition) for account, definition in rows)


async def get_account_with_definition(
    db: AsyncSession,
    account_id: UUID,
) -> IntegrationAccountWithDefinitionRecord | None:
    row = (
        await db.execute(
            select(CloudIntegrationAccount, CloudIntegrationDefinition)
            .join(
                CloudIntegrationDefinition,
                CloudIntegrationDefinition.id == CloudIntegrationAccount.definition_id,
            )
            .where(CloudIntegrationAccount.id == account_id)
        )
    ).one_or_none()
    if row is None:
        return None
    account, definition = row
    return _account_with_definition_record(account, definition)


async def upsert_personal_account(
    db: AsyncSession,
    *,
    user_id: UUID,
    definition_id: UUID,
    auth_kind: str,
    status: str,
    settings_json: str,
    credential_ciphertext: str | None | object = _UNSET,
    token_expires_at: datetime | None | object = _UNSET,
    last_error_code: str | None | object = _UNSET,
    enabled: bool = True,
) -> IntegrationAccountRecord:
    row = (
        await db.execute(
            select(CloudIntegrationAccount).where(
                CloudIntegrationAccount.owner_scope == "personal",
                CloudIntegrationAccount.owner_user_id == user_id,
                CloudIntegrationAccount.definition_id == definition_id,
            )
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = CloudIntegrationAccount(
            owner_scope="personal",
            owner_user_id=user_id,
            organization_id=None,
            definition_id=definition_id,
            auth_kind=auth_kind,
            status=status,
            settings_json=settings_json,
            credential_ciphertext=(
                credential_ciphertext if isinstance(credential_ciphertext, str) else None
            ),
            auth_version=1,
            token_expires_at=(
                token_expires_at if isinstance(token_expires_at, datetime) else None
            ),
            last_error_code=last_error_code if isinstance(last_error_code, str) else None,
            enabled=enabled,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.auth_kind = auth_kind
        row.status = status
        row.settings_json = settings_json
        if credential_ciphertext is not _UNSET:
            row.credential_ciphertext = credential_ciphertext if isinstance(credential_ciphertext, str) else None
            row.auth_version += 1
        if token_expires_at is not _UNSET:
            row.token_expires_at = token_expires_at if isinstance(token_expires_at, datetime) else None
        if last_error_code is not _UNSET:
            row.last_error_code = last_error_code if isinstance(last_error_code, str) else None
        row.enabled = enabled
        row.updated_at = now
    await db.flush()
    await db.refresh(row)
    return _account_record(row)


async def patch_account(
    db: AsyncSession,
    *,
    account_id: UUID,
    enabled: bool | None = None,
    status: str | None = None,
    settings_json: str | None = None,
    credential_ciphertext: str | None | object = _UNSET,
    token_expires_at: datetime | None | object = _UNSET,
    last_error_code: str | None | object = _UNSET,
    bump_auth_version: bool = False,
) -> IntegrationAccountRecord | None:
    row = await db.get(CloudIntegrationAccount, account_id)
    if row is None:
        return None
    if enabled is not None:
        row.enabled = enabled
    if status is not None:
        row.status = status
    if settings_json is not None:
        row.settings_json = settings_json
    if credential_ciphertext is not _UNSET:
        row.credential_ciphertext = credential_ciphertext if isinstance(credential_ciphertext, str) else None
        row.auth_version += 1
    elif bump_auth_version:
        row.auth_version += 1
    if token_expires_at is not _UNSET:
        row.token_expires_at = token_expires_at if isinstance(token_expires_at, datetime) else None
    if last_error_code is not _UNSET:
        row.last_error_code = last_error_code if isinstance(last_error_code, str) else None
    row.updated_at = utcnow()
    await db.flush()
    await db.refresh(row)
    return _account_record(row)


async def delete_account(db: AsyncSession, account_id: UUID) -> None:
    row = await db.get(CloudIntegrationAccount, account_id)
    if row is None:
        return
    await db.delete(row)
    await db.flush()
