"""Persistence helpers for repo-scoped cloud configuration."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.models.cloud import CloudRepoConfig, CloudRepoFile
from proliferate.utils.crypto import decrypt_json, decrypt_text, encrypt_json, encrypt_text
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudRepoFileValue:
    relative_path: str
    content: str
    content_sha256: str
    byte_size: int
    created_at: datetime
    updated_at: datetime
    last_synced_at: datetime


@dataclass(frozen=True)
class CloudRepoConfigValue:
    id: UUID
    user_id: UUID
    git_owner: str
    git_repo_name: str
    configured: bool
    configured_at: datetime | None
    default_branch: str | None
    env_vars: dict[str, str]
    setup_script: str
    files_version: int
    tracked_files: tuple[CloudRepoFileValue, ...]
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CloudRepoConfigSummaryValue:
    git_owner: str
    git_repo_name: str
    configured: bool
    configured_at: datetime | None
    files_version: int


@dataclass(frozen=True)
class CloudRepoFileInput:
    relative_path: str
    content: str


def _sha256_text(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _repo_file_value(record: CloudRepoFile) -> CloudRepoFileValue:
    return CloudRepoFileValue(
        relative_path=record.relative_path,
        content=decrypt_text(record.content_ciphertext),
        content_sha256=record.content_sha256,
        byte_size=record.byte_size,
        created_at=record.created_at,
        updated_at=record.updated_at,
        last_synced_at=record.last_synced_at,
    )


def _repo_config_value(
    record: CloudRepoConfig,
    files: list[CloudRepoFile],
) -> CloudRepoConfigValue:
    return CloudRepoConfigValue(
        id=record.id,
        user_id=record.user_id,
        git_owner=record.git_owner,
        git_repo_name=record.git_repo_name,
        configured=record.configured,
        configured_at=record.configured_at,
        default_branch=record.default_branch,
        env_vars=decrypt_json(record.env_vars_ciphertext) if record.env_vars_ciphertext else {},
        setup_script=record.setup_script,
        files_version=record.files_version,
        tracked_files=tuple(
            sorted(
                (_repo_file_value(item) for item in files),
                key=lambda item: item.relative_path,
            )
        ),
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


async def list_cloud_repo_configs(
    db: AsyncSession,
    user_id: UUID,
) -> list[CloudRepoConfigSummaryValue]:
    records = list(
        (
            await db.execute(
                select(CloudRepoConfig)
                .where(CloudRepoConfig.user_id == user_id)
                .order_by(CloudRepoConfig.git_owner.asc(), CloudRepoConfig.git_repo_name.asc())
            )
        )
        .scalars()
        .all()
    )
    return [
        CloudRepoConfigSummaryValue(
            git_owner=record.git_owner,
            git_repo_name=record.git_repo_name,
            configured=record.configured,
            configured_at=record.configured_at,
            files_version=record.files_version,
        )
        for record in records
    ]


async def get_cloud_repo_config(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> CloudRepoConfigValue | None:
    record = (
        await db.execute(
            select(CloudRepoConfig).where(
                CloudRepoConfig.user_id == user_id,
                CloudRepoConfig.git_owner == git_owner,
                CloudRepoConfig.git_repo_name == git_repo_name,
            )
        )
    ).scalar_one_or_none()
    if record is None:
        return None
    files = list(
        (
            await db.execute(
                select(CloudRepoFile)
                .where(CloudRepoFile.cloud_repo_config_id == record.id)
                .order_by(CloudRepoFile.relative_path.asc())
            )
        )
        .scalars()
        .all()
    )
    return _repo_config_value(record, files)


async def _get_or_create_repo_config_record(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> CloudRepoConfig:
    now = utcnow()
    await db.execute(
        pg_insert(CloudRepoConfig)
        .values(
            user_id=user_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            configured=False,
            configured_at=None,
            default_branch=None,
            env_vars_ciphertext=encrypt_json({}),
            setup_script="",
            files_version=0,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(
            index_elements=[
                CloudRepoConfig.user_id,
                CloudRepoConfig.git_owner,
                CloudRepoConfig.git_repo_name,
            ]
        )
    )
    return (
        await db.execute(
            select(CloudRepoConfig).where(
                CloudRepoConfig.user_id == user_id,
                CloudRepoConfig.git_owner == git_owner,
                CloudRepoConfig.git_repo_name == git_repo_name,
            )
        )
    ).scalar_one()


async def _load_repo_file_rows(
    db: AsyncSession,
    cloud_repo_config_id: UUID,
) -> list[CloudRepoFile]:
    return list(
        (
            await db.execute(
                select(CloudRepoFile)
                .where(CloudRepoFile.cloud_repo_config_id == cloud_repo_config_id)
                .order_by(CloudRepoFile.relative_path.asc())
            )
        )
        .scalars()
        .all()
    )


async def save_cloud_repo_config(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    configured: bool,
    default_branch: str | None,
    env_vars: dict[str, str],
    setup_script: str,
    files: list[CloudRepoFileInput],
) -> CloudRepoConfigValue:
    record = await _get_or_create_repo_config_record(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    now = utcnow()
    existing_files = await _load_repo_file_rows(db, record.id)
    existing_by_path = {item.relative_path: item for item in existing_files}

    incoming_by_path = {item.relative_path: item for item in files}
    incoming_hashes = {path: _sha256_text(item.content) for path, item in incoming_by_path.items()}
    existing_hashes = {item.relative_path: item.content_sha256 for item in existing_files}
    files_changed = set(existing_by_path) != set(incoming_by_path) or any(
        existing_hashes.get(path) != incoming_hashes[path] for path in incoming_by_path
    )

    record.env_vars_ciphertext = encrypt_json(env_vars)
    record.setup_script = setup_script
    record.configured = configured
    record.configured_at = now if configured else None
    record.default_branch = default_branch.strip() if default_branch and default_branch.strip() else None
    if files_changed:
        record.files_version += 1
    record.updated_at = now

    for item in existing_files:
        if item.relative_path not in incoming_by_path:
            await db.delete(item)

    for relative_path, payload in incoming_by_path.items():
        sha256 = incoming_hashes[relative_path]
        byte_size = len(payload.content.encode("utf-8"))
        existing = existing_by_path.get(relative_path)
        if existing is None:
            db.add(
                CloudRepoFile(
                    cloud_repo_config_id=record.id,
                    relative_path=relative_path,
                    content_ciphertext=encrypt_text(payload.content),
                    content_sha256=sha256,
                    byte_size=byte_size,
                    created_at=now,
                    updated_at=now,
                    last_synced_at=now,
                )
            )
            continue

        existing.content_ciphertext = encrypt_text(payload.content)
        existing.content_sha256 = sha256
        existing.byte_size = byte_size
        existing.updated_at = now
        existing.last_synced_at = now

    await db.commit()
    return await get_cloud_repo_config(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )  # type: ignore[return-value]


async def save_cloud_repo_file(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    relative_path: str,
    content: str,
) -> CloudRepoConfigValue:
    record = await _get_or_create_repo_config_record(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    now = utcnow()
    existing_files = await _load_repo_file_rows(db, record.id)
    existing = next((item for item in existing_files if item.relative_path == relative_path), None)
    sha256 = _sha256_text(content)
    byte_size = len(content.encode("utf-8"))
    if existing is None:
        db.add(
            CloudRepoFile(
                cloud_repo_config_id=record.id,
                relative_path=relative_path,
                content_ciphertext=encrypt_text(content),
                content_sha256=sha256,
                byte_size=byte_size,
                created_at=now,
                updated_at=now,
                last_synced_at=now,
            )
        )
        record.files_version += 1
    else:
        changed = existing.content_sha256 != sha256
        existing.content_ciphertext = encrypt_text(content)
        existing.content_sha256 = sha256
        existing.byte_size = byte_size
        existing.updated_at = now
        existing.last_synced_at = now
        if changed:
            record.files_version += 1

    record.updated_at = now
    await db.commit()
    return await get_cloud_repo_config(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )  # type: ignore[return-value]


async def bootstrap_cloud_repo_config(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> CloudRepoConfigValue:
    record = await _get_or_create_repo_config_record(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    now = utcnow()
    record.configured = True
    record.configured_at = now
    record.updated_at = now
    await db.commit()
    return await get_cloud_repo_config(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )  # type: ignore[return-value]


async def list_cloud_repo_configs_for_user(user_id: UUID) -> list[CloudRepoConfigSummaryValue]:
    async with db_engine.async_session_factory() as db:
        return await list_cloud_repo_configs(db, user_id)


async def load_cloud_repo_config_for_user(
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> CloudRepoConfigValue | None:
    async with db_engine.async_session_factory() as db:
        return await get_cloud_repo_config(
            db,
            user_id=user_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )


async def persist_cloud_repo_config(
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    configured: bool,
    default_branch: str | None,
    env_vars: dict[str, str],
    setup_script: str,
    files: list[CloudRepoFileInput],
) -> CloudRepoConfigValue:
    async with db_engine.async_session_factory() as db:
        return await save_cloud_repo_config(
            db,
            user_id=user_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            configured=configured,
            default_branch=default_branch,
            env_vars=env_vars,
            setup_script=setup_script,
            files=files,
        )


async def persist_cloud_repo_file(
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    relative_path: str,
    content: str,
) -> CloudRepoConfigValue:
    async with db_engine.async_session_factory() as db:
        return await save_cloud_repo_file(
            db,
            user_id=user_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            relative_path=relative_path,
            content=content,
        )


async def bootstrap_cloud_repo_config_for_user(
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> CloudRepoConfigValue:
    async with db_engine.async_session_factory() as db:
        return await bootstrap_cloud_repo_config(
            db,
            user_id=user_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
