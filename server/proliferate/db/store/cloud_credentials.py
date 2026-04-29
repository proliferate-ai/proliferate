"""Persistence helpers for cloud credentials."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.models.cloud import CloudCredential
from proliferate.server.cloud.credentials.models import CloudAgentKind
from proliferate.utils.time import utcnow


async def get_user_cloud_credentials(
    db: AsyncSession,
    user_id: UUID,
) -> list[CloudCredential]:
    return list(
        (
            await db.execute(
                select(CloudCredential)
                .where(CloudCredential.user_id == user_id)
                .order_by(CloudCredential.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )


async def sync_cloud_credential(
    db: AsyncSession,
    user_id: UUID,
    provider: CloudAgentKind,
    payload_ciphertext: str,
    auth_mode: Literal["env", "file"],
    payload_format: str = "json-v1",
) -> None:
    existing = list(
        (
            await db.execute(
                select(CloudCredential).where(
                    CloudCredential.user_id == user_id,
                    CloudCredential.provider == provider,
                    CloudCredential.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )

    now = utcnow()
    for record in existing:
        record.revoked_at = now

    db.add(
        CloudCredential(
            user_id=user_id,
            provider=provider,
            auth_mode=auth_mode,
            payload_ciphertext=payload_ciphertext,
            payload_format=payload_format,
            created_at=now,
            updated_at=now,
            last_synced_at=now,
        )
    )
    await db.commit()


async def touch_active_cloud_credential_sync(
    db: AsyncSession,
    user_id: UUID,
    provider: CloudAgentKind,
) -> None:
    now = utcnow()
    records = list(
        (
            await db.execute(
                select(CloudCredential).where(
                    CloudCredential.user_id == user_id,
                    CloudCredential.provider == provider,
                    CloudCredential.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for record in records:
        record.last_synced_at = now
    await db.commit()


async def delete_cloud_credential(
    db: AsyncSession,
    user_id: UUID,
    provider: CloudAgentKind,
) -> None:
    now = utcnow()
    records = list(
        (
            await db.execute(
                select(CloudCredential).where(
                    CloudCredential.user_id == user_id,
                    CloudCredential.provider == provider,
                    CloudCredential.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for record in records:
        record.revoked_at = now
    await db.commit()


async def load_cloud_credentials_for_user(user_id: UUID) -> list[CloudCredential]:
    async with db_engine.async_session_factory() as db:
        return await get_user_cloud_credentials(db, user_id)


async def persist_cloud_credential_sync(
    user_id: UUID,
    provider: CloudAgentKind,
    payload_ciphertext: str,
    auth_mode: Literal["env", "file"],
    payload_format: str = "json-v1",
) -> None:
    async with db_engine.async_session_factory() as db:
        await sync_cloud_credential(
            db,
            user_id,
            provider,
            payload_ciphertext,
            auth_mode,
            payload_format,
        )


async def persist_cloud_credential_touch(
    user_id: UUID,
    provider: CloudAgentKind,
) -> None:
    async with db_engine.async_session_factory() as db:
        await touch_active_cloud_credential_sync(db, user_id, provider)


async def persist_cloud_credential_delete(
    user_id: UUID,
    provider: CloudAgentKind,
) -> None:
    async with db_engine.async_session_factory() as db:
        await delete_cloud_credential(db, user_id, provider)
