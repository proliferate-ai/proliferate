"""Persistence helpers for cloud-managed secrets."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.secrets import (
    CloudSecretEnvVar,
    CloudSecretFile,
    CloudSecretSet,
)
from proliferate.utils.crypto import decrypt_text, encrypt_text
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudSecretEnvVarValue:
    id: UUID
    secret_set_id: UUID
    name: str
    value_sha256: str
    byte_size: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CloudSecretFileValue:
    id: UUID
    secret_set_id: UUID
    path: str
    content_sha256: str
    byte_size: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CloudSecretSetValue:
    id: UUID
    scope_kind: str
    user_id: UUID | None
    organization_id: UUID | None
    cloud_repo_config_id: UUID | None
    version: int
    created_by_user_id: UUID | None
    updated_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime
    env_vars: tuple[CloudSecretEnvVarValue, ...]
    files: tuple[CloudSecretFileValue, ...]


@dataclass(frozen=True)
class CloudSecretEnvVarPayload:
    name: str
    value: str
    value_sha256: str
    byte_size: int


@dataclass(frozen=True)
class CloudSecretFilePayload:
    path: str
    content: str
    content_sha256: str
    byte_size: int


@dataclass(frozen=True)
class CloudSecretSetPayload:
    id: UUID
    scope_kind: str
    user_id: UUID | None
    organization_id: UUID | None
    cloud_repo_config_id: UUID | None
    version: int
    env_vars: tuple[CloudSecretEnvVarPayload, ...]
    files: tuple[CloudSecretFilePayload, ...]


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _env_value(row: CloudSecretEnvVar) -> CloudSecretEnvVarValue:
    return CloudSecretEnvVarValue(
        id=row.id,
        secret_set_id=row.secret_set_id,
        name=row.name,
        value_sha256=row.value_sha256,
        byte_size=row.byte_size,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _file_value(row: CloudSecretFile) -> CloudSecretFileValue:
    return CloudSecretFileValue(
        id=row.id,
        secret_set_id=row.secret_set_id,
        path=row.path,
        content_sha256=row.content_sha256,
        byte_size=row.byte_size,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _env_payload(row: CloudSecretEnvVar) -> CloudSecretEnvVarPayload:
    return CloudSecretEnvVarPayload(
        name=row.name,
        value=decrypt_text(row.value_ciphertext),
        value_sha256=row.value_sha256,
        byte_size=row.byte_size,
    )


def _file_payload(row: CloudSecretFile) -> CloudSecretFilePayload:
    return CloudSecretFilePayload(
        path=row.path,
        content=decrypt_text(row.content_ciphertext),
        content_sha256=row.content_sha256,
        byte_size=row.byte_size,
    )


async def _load_env_var_rows(
    db: AsyncSession,
    secret_set_id: UUID,
) -> list[CloudSecretEnvVar]:
    return list(
        (
            await db.execute(
                select(CloudSecretEnvVar)
                .where(CloudSecretEnvVar.secret_set_id == secret_set_id)
                .order_by(CloudSecretEnvVar.name.asc())
            )
        )
        .scalars()
        .all()
    )


async def _load_file_rows(
    db: AsyncSession,
    secret_set_id: UUID,
) -> list[CloudSecretFile]:
    return list(
        (
            await db.execute(
                select(CloudSecretFile)
                .where(CloudSecretFile.secret_set_id == secret_set_id)
                .order_by(CloudSecretFile.path.asc())
            )
        )
        .scalars()
        .all()
    )


async def _secret_set_value(
    db: AsyncSession,
    row: CloudSecretSet,
) -> CloudSecretSetValue:
    env_rows = await _load_env_var_rows(db, row.id)
    file_rows = await _load_file_rows(db, row.id)
    return CloudSecretSetValue(
        id=row.id,
        scope_kind=row.scope_kind,
        user_id=row.user_id,
        organization_id=row.organization_id,
        cloud_repo_config_id=row.cloud_repo_config_id,
        version=row.version,
        created_by_user_id=row.created_by_user_id,
        updated_by_user_id=row.updated_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        env_vars=tuple(_env_value(item) for item in env_rows),
        files=tuple(_file_value(item) for item in file_rows),
    )


async def _get_or_create_secret_set(
    db: AsyncSession,
    *,
    scope_kind: str,
    user_id: UUID | None,
    organization_id: UUID | None,
    cloud_repo_config_id: UUID | None,
    actor_user_id: UUID,
) -> CloudSecretSet:
    now = utcnow()
    values = {
        "scope_kind": scope_kind,
        "user_id": user_id,
        "organization_id": organization_id,
        "cloud_repo_config_id": cloud_repo_config_id,
        "version": 0,
        "created_by_user_id": actor_user_id,
        "updated_by_user_id": actor_user_id,
        "created_at": now,
        "updated_at": now,
    }
    insert_stmt = pg_insert(CloudSecretSet).values(**values)
    if scope_kind == "personal":
        insert_stmt = insert_stmt.on_conflict_do_nothing(
            index_elements=[CloudSecretSet.user_id],
            index_where=CloudSecretSet.scope_kind == "personal",
        )
        where = (
            CloudSecretSet.scope_kind == "personal",
            CloudSecretSet.user_id == user_id,
        )
    elif scope_kind == "organization":
        insert_stmt = insert_stmt.on_conflict_do_nothing(
            index_elements=[CloudSecretSet.organization_id],
            index_where=CloudSecretSet.scope_kind == "organization",
        )
        where = (
            CloudSecretSet.scope_kind == "organization",
            CloudSecretSet.organization_id == organization_id,
        )
    elif scope_kind == "workspace":
        insert_stmt = insert_stmt.on_conflict_do_nothing(
            index_elements=[CloudSecretSet.cloud_repo_config_id],
            index_where=CloudSecretSet.scope_kind == "workspace",
        )
        where = (
            CloudSecretSet.scope_kind == "workspace",
            CloudSecretSet.cloud_repo_config_id == cloud_repo_config_id,
        )
    else:
        raise ValueError(f"Unsupported cloud secret scope: {scope_kind}")

    await db.execute(insert_stmt)
    return (await db.execute(select(CloudSecretSet).where(*where))).scalar_one()


async def get_or_create_personal_secret_set(
    db: AsyncSession,
    *,
    user_id: UUID,
    actor_user_id: UUID,
) -> CloudSecretSetValue:
    row = await _get_or_create_secret_set(
        db,
        scope_kind="personal",
        user_id=user_id,
        organization_id=None,
        cloud_repo_config_id=None,
        actor_user_id=actor_user_id,
    )
    return await _secret_set_value(db, row)


async def get_or_create_organization_secret_set(
    db: AsyncSession,
    *,
    organization_id: UUID,
    actor_user_id: UUID,
) -> CloudSecretSetValue:
    row = await _get_or_create_secret_set(
        db,
        scope_kind="organization",
        user_id=None,
        organization_id=organization_id,
        cloud_repo_config_id=None,
        actor_user_id=actor_user_id,
    )
    return await _secret_set_value(db, row)


async def get_or_create_workspace_secret_set(
    db: AsyncSession,
    *,
    cloud_repo_config_id: UUID,
    actor_user_id: UUID,
) -> CloudSecretSetValue:
    row = await _get_or_create_secret_set(
        db,
        scope_kind="workspace",
        user_id=None,
        organization_id=None,
        cloud_repo_config_id=cloud_repo_config_id,
        actor_user_id=actor_user_id,
    )
    return await _secret_set_value(db, row)


async def load_personal_secret_set(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> CloudSecretSetValue | None:
    row = (
        await db.execute(
            select(CloudSecretSet).where(
                CloudSecretSet.scope_kind == "personal",
                CloudSecretSet.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    return None if row is None else await _secret_set_value(db, row)


async def load_organization_secret_set(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> CloudSecretSetValue | None:
    row = (
        await db.execute(
            select(CloudSecretSet).where(
                CloudSecretSet.scope_kind == "organization",
                CloudSecretSet.organization_id == organization_id,
            )
        )
    ).scalar_one_or_none()
    return None if row is None else await _secret_set_value(db, row)


async def load_workspace_secret_set(
    db: AsyncSession,
    *,
    cloud_repo_config_id: UUID,
) -> CloudSecretSetValue | None:
    row = (
        await db.execute(
            select(CloudSecretSet).where(
                CloudSecretSet.scope_kind == "workspace",
                CloudSecretSet.cloud_repo_config_id == cloud_repo_config_id,
            )
        )
    ).scalar_one_or_none()
    return None if row is None else await _secret_set_value(db, row)


async def load_secret_set_payload(
    db: AsyncSession,
    *,
    secret_set_id: UUID,
) -> CloudSecretSetPayload | None:
    row = await db.get(CloudSecretSet, secret_set_id)
    if row is None:
        return None
    env_rows = await _load_env_var_rows(db, row.id)
    file_rows = await _load_file_rows(db, row.id)
    return CloudSecretSetPayload(
        id=row.id,
        scope_kind=row.scope_kind,
        user_id=row.user_id,
        organization_id=row.organization_id,
        cloud_repo_config_id=row.cloud_repo_config_id,
        version=row.version,
        env_vars=tuple(_env_payload(item) for item in env_rows),
        files=tuple(_file_payload(item) for item in file_rows),
    )


async def load_personal_secret_payload(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> CloudSecretSetPayload | None:
    value = await load_personal_secret_set(db, user_id=user_id)
    return None if value is None else await load_secret_set_payload(db, secret_set_id=value.id)


async def load_organization_secret_payload(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> CloudSecretSetPayload | None:
    value = await load_organization_secret_set(db, organization_id=organization_id)
    return None if value is None else await load_secret_set_payload(db, secret_set_id=value.id)


async def load_workspace_secret_payload(
    db: AsyncSession,
    *,
    cloud_repo_config_id: UUID,
) -> CloudSecretSetPayload | None:
    value = await load_workspace_secret_set(db, cloud_repo_config_id=cloud_repo_config_id)
    return None if value is None else await load_secret_set_payload(db, secret_set_id=value.id)


async def list_organization_secret_payloads_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[CloudSecretSetPayload, ...]:
    from proliferate.constants.organizations import ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
    from proliferate.db.models.organizations import OrganizationMembership

    rows = list(
        (
            await db.execute(
                select(CloudSecretSet)
                .join(
                    OrganizationMembership,
                    OrganizationMembership.organization_id == CloudSecretSet.organization_id,
                )
                .where(
                    CloudSecretSet.scope_kind == "organization",
                    OrganizationMembership.user_id == user_id,
                    OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                )
                .order_by(CloudSecretSet.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    payloads: list[CloudSecretSetPayload] = []
    for row in rows:
        payload = await load_secret_set_payload(db, secret_set_id=row.id)
        if payload is not None:
            payloads.append(payload)
    return tuple(payloads)


async def upsert_secret_env_var(
    db: AsyncSession,
    *,
    secret_set_id: UUID,
    name: str,
    value: str,
    actor_user_id: UUID,
) -> CloudSecretSetValue:
    secret_set = await db.get(CloudSecretSet, secret_set_id)
    if secret_set is None:
        raise ValueError("Secret set not found.")
    now = utcnow()
    value_sha256 = _sha256_text(value)
    byte_size = len(value.encode("utf-8"))
    row = (
        await db.execute(
            select(CloudSecretEnvVar).where(
                CloudSecretEnvVar.secret_set_id == secret_set_id,
                CloudSecretEnvVar.name == name,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        db.add(
            CloudSecretEnvVar(
                secret_set_id=secret_set_id,
                name=name,
                value_ciphertext=encrypt_text(value),
                value_sha256=value_sha256,
                byte_size=byte_size,
                created_at=now,
                updated_at=now,
            )
        )
        secret_set.version += 1
    elif row.value_sha256 != value_sha256 or row.byte_size != byte_size:
        row.value_ciphertext = encrypt_text(value)
        row.value_sha256 = value_sha256
        row.byte_size = byte_size
        row.updated_at = now
        secret_set.version += 1
    secret_set.updated_by_user_id = actor_user_id
    secret_set.updated_at = now
    await db.flush()
    return await _secret_set_value(db, secret_set)


async def delete_secret_env_var(
    db: AsyncSession,
    *,
    secret_set_id: UUID,
    name: str,
    actor_user_id: UUID,
) -> CloudSecretSetValue:
    secret_set = await db.get(CloudSecretSet, secret_set_id)
    if secret_set is None:
        raise ValueError("Secret set not found.")
    row = (
        await db.execute(
            select(CloudSecretEnvVar).where(
                CloudSecretEnvVar.secret_set_id == secret_set_id,
                CloudSecretEnvVar.name == name,
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        secret_set.version += 1
    secret_set.updated_by_user_id = actor_user_id
    secret_set.updated_at = utcnow()
    await db.flush()
    return await _secret_set_value(db, secret_set)


async def upsert_secret_file(
    db: AsyncSession,
    *,
    secret_set_id: UUID,
    path: str,
    content: str,
    actor_user_id: UUID,
) -> CloudSecretSetValue:
    secret_set = await db.get(CloudSecretSet, secret_set_id)
    if secret_set is None:
        raise ValueError("Secret set not found.")
    now = utcnow()
    content_sha256 = _sha256_text(content)
    byte_size = len(content.encode("utf-8"))
    row = (
        await db.execute(
            select(CloudSecretFile).where(
                CloudSecretFile.secret_set_id == secret_set_id,
                CloudSecretFile.path == path,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        db.add(
            CloudSecretFile(
                secret_set_id=secret_set_id,
                path=path,
                content_ciphertext=encrypt_text(content),
                content_sha256=content_sha256,
                byte_size=byte_size,
                created_at=now,
                updated_at=now,
            )
        )
        secret_set.version += 1
    elif row.content_sha256 != content_sha256 or row.byte_size != byte_size:
        row.content_ciphertext = encrypt_text(content)
        row.content_sha256 = content_sha256
        row.byte_size = byte_size
        row.updated_at = now
        secret_set.version += 1
    secret_set.updated_by_user_id = actor_user_id
    secret_set.updated_at = now
    await db.flush()
    return await _secret_set_value(db, secret_set)


async def delete_secret_file(
    db: AsyncSession,
    *,
    secret_set_id: UUID,
    path: str,
    actor_user_id: UUID,
) -> CloudSecretSetValue:
    secret_set = await db.get(CloudSecretSet, secret_set_id)
    if secret_set is None:
        raise ValueError("Secret set not found.")
    row = (
        await db.execute(
            select(CloudSecretFile).where(
                CloudSecretFile.secret_set_id == secret_set_id,
                CloudSecretFile.path == path,
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        secret_set.version += 1
    secret_set.updated_by_user_id = actor_user_id
    secret_set.updated_at = utcnow()
    await db.flush()
    return await _secret_set_value(db, secret_set)
