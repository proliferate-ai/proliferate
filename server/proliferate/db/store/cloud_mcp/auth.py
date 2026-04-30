from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select

from proliferate.db import engine as db_engine
from proliferate.db.models.cloud import CloudMcpConnection, CloudMcpConnectionAuth
from proliferate.db.store.cloud_mcp.types import CloudMcpAuthRecord
from proliferate.utils.time import utcnow


def _record(auth: CloudMcpConnectionAuth) -> CloudMcpAuthRecord:
    return CloudMcpAuthRecord(
        id=auth.id,
        connection_db_id=auth.connection_db_id,
        auth_kind=auth.auth_kind,
        auth_status=auth.auth_status,
        payload_ciphertext=auth.payload_ciphertext,
        payload_format=auth.payload_format,
        auth_version=auth.auth_version,
        token_expires_at=auth.token_expires_at,
        last_error_code=auth.last_error_code,
        created_at=auth.created_at,
        updated_at=auth.updated_at,
    )


async def upsert_connection_auth(
    *,
    connection_db_id: UUID,
    auth_kind: str,
    auth_status: str,
    payload_ciphertext: str | None,
    payload_format: str,
    token_expires_at: datetime | None = None,
    last_error_code: str | None = None,
) -> CloudMcpAuthRecord:
    async with db_engine.async_session_factory() as db:
        auth = (
            await db.execute(
                select(CloudMcpConnectionAuth).where(
                    CloudMcpConnectionAuth.connection_db_id == connection_db_id
                )
            )
        ).scalar_one_or_none()
        now = utcnow()
        if auth is None:
            auth = CloudMcpConnectionAuth(
                connection_db_id=connection_db_id,
                auth_kind=auth_kind,
                auth_status=auth_status,
                payload_ciphertext=payload_ciphertext,
                payload_format=payload_format,
                auth_version=1,
                token_expires_at=token_expires_at,
                last_error_code=last_error_code,
                created_at=now,
                updated_at=now,
            )
            db.add(auth)
        else:
            auth.auth_kind = auth_kind
            auth.auth_status = auth_status
            auth.payload_ciphertext = payload_ciphertext
            auth.payload_format = payload_format
            auth.auth_version += 1
            auth.token_expires_at = token_expires_at
            auth.last_error_code = last_error_code
            auth.updated_at = now
        connection = await db.get(CloudMcpConnection, connection_db_id)
        if connection is not None:
            connection.last_synced_at = now
            connection.updated_at = now
        await db.commit()
        await db.refresh(auth)
        return _record(auth)


async def load_connection_auth(
    *,
    connection_db_id: UUID,
) -> CloudMcpAuthRecord | None:
    async with db_engine.async_session_factory() as db:
        auth = (
            await db.execute(
                select(CloudMcpConnectionAuth).where(
                    CloudMcpConnectionAuth.connection_db_id == connection_db_id
                )
            )
        ).scalar_one_or_none()
        if auth is None:
            return None
        return _record(auth)


async def update_connection_auth_if_version(
    *,
    connection_db_id: UUID,
    expected_auth_version: int,
    auth_kind: str,
    auth_status: str,
    payload_ciphertext: str | None,
    payload_format: str,
    token_expires_at: datetime | None = None,
    last_error_code: str | None = None,
) -> CloudMcpAuthRecord | None:
    async with db_engine.async_session_factory() as db:
        auth = (
            await db.execute(
                select(CloudMcpConnectionAuth)
                .where(CloudMcpConnectionAuth.connection_db_id == connection_db_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if auth is None or auth.auth_version != expected_auth_version:
            return None

        now = utcnow()
        auth.auth_kind = auth_kind
        auth.auth_status = auth_status
        auth.payload_ciphertext = payload_ciphertext
        auth.payload_format = payload_format
        auth.auth_version += 1
        auth.token_expires_at = token_expires_at
        auth.last_error_code = last_error_code
        auth.updated_at = now
        connection = await db.get(CloudMcpConnection, connection_db_id)
        if connection is not None:
            connection.last_synced_at = now
            connection.updated_at = now
        await db.commit()
        await db.refresh(auth)
        return _record(auth)


async def mark_connection_auth_status_if_version(
    *,
    connection_db_id: UUID,
    expected_auth_version: int,
    auth_kind: str,
    auth_status: str,
    last_error_code: str | None,
) -> CloudMcpAuthRecord | None:
    async with db_engine.async_session_factory() as db:
        auth = (
            await db.execute(
                select(CloudMcpConnectionAuth)
                .where(CloudMcpConnectionAuth.connection_db_id == connection_db_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if auth is None or auth.auth_version != expected_auth_version:
            return None

        auth.auth_kind = auth_kind
        auth.auth_status = auth_status
        auth.last_error_code = last_error_code
        auth.updated_at = utcnow()
        await db.commit()
        await db.refresh(auth)
        return _record(auth)
