"""Persistence helpers for cloud credentials."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudAgentKind
from proliferate.db.models.cloud.credentials import CloudCredential
from proliferate.utils.crypto import decrypt_json
from proliferate.utils.time import utcnow

CloudCredentialPayloadMatches = Callable[[str], bool]


@dataclass(frozen=True)
class CloudCredentialRecord:
    id: UUID
    provider: str
    auth_mode: str
    payload_ciphertext: str
    payload_format: str
    revoked_at: datetime | None
    last_synced_at: datetime | None
    updated_at: datetime | None


async def get_user_cloud_credentials(
    db: AsyncSession,
    user_id: UUID,
) -> list[CloudCredentialRecord]:
    records = (
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
    return [_credential_record(record) for record in records]


async def get_cloud_credential_by_id(
    db: AsyncSession,
    credential_id: UUID,
) -> CloudCredentialRecord | None:
    record = await db.get(CloudCredential, credential_id)
    return _credential_record(record) if record is not None else None


async def sync_cloud_credential_if_changed(
    db: AsyncSession,
    user_id: UUID,
    provider: CloudAgentKind,
    payload_ciphertext: str,
    auth_mode: Literal["env", "file"],
    payload_matches: CloudCredentialPayloadMatches,
    payload_format: str = "json-v1",
) -> bool:
    existing = list(
        (
            await db.execute(
                select(CloudCredential)
                .where(
                    CloudCredential.user_id == user_id,
                    CloudCredential.provider == provider,
                    CloudCredential.revoked_at.is_(None),
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )

    now = utcnow()
    if len(existing) == 1:
        active = existing[0]
        active_payload = decrypt_json(active.payload_ciphertext)
        incoming_payload = decrypt_json(payload_ciphertext)
        if (
            active.auth_mode == auth_mode
            and active.payload_format == payload_format
            and active_payload == incoming_payload
        ):
            active.last_synced_at = now
            active.updated_at = now
            return False

    for record in existing:
        if record.payload_format == payload_format and payload_matches(record.payload_ciphertext):
            record.last_synced_at = now
            return False

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
    return True


async def delete_cloud_credential(
    db: AsyncSession,
    user_id: UUID,
    provider: CloudAgentKind,
) -> bool:
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
    return bool(records)


def _credential_record(record: CloudCredential) -> CloudCredentialRecord:
    return CloudCredentialRecord(
        id=record.id,
        provider=record.provider,
        auth_mode=record.auth_mode,
        payload_ciphertext=record.payload_ciphertext,
        payload_format=record.payload_format,
        revoked_at=record.revoked_at,
        last_synced_at=record.last_synced_at,
        updated_at=record.updated_at,
    )
