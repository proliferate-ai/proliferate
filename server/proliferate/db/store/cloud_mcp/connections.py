from __future__ import annotations

import uuid
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.models.cloud import (
    CloudMcpConnection,
    CloudMcpConnectionAuth,
    CloudMcpOAuthFlow,
)
from proliferate.db.store.cloud_mcp.types import CloudMcpAuthRecord, CloudMcpConnectionRecord
from proliferate.utils.time import utcnow


def _auth_record(record: CloudMcpConnectionAuth | None) -> CloudMcpAuthRecord | None:
    if record is None:
        return None
    return CloudMcpAuthRecord(
        id=record.id,
        connection_db_id=record.connection_db_id,
        auth_kind=record.auth_kind,
        auth_status=record.auth_status,
        payload_ciphertext=record.payload_ciphertext,
        payload_format=record.payload_format,
        auth_version=record.auth_version,
        token_expires_at=record.token_expires_at,
        last_error_code=record.last_error_code,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


async def _load_auth(
    db: AsyncSession,
    connection_db_id: UUID,
) -> CloudMcpConnectionAuth | None:
    return (
        await db.execute(
            select(CloudMcpConnectionAuth).where(
                CloudMcpConnectionAuth.connection_db_id == connection_db_id
            )
        )
    ).scalar_one_or_none()


async def _connection_record(
    db: AsyncSession,
    record: CloudMcpConnection,
) -> CloudMcpConnectionRecord:
    return CloudMcpConnectionRecord(
        id=record.id,
        user_id=record.user_id,
        org_id=record.org_id,
        connection_id=record.connection_id,
        catalog_entry_id=record.catalog_entry_id,
        custom_definition_db_id=record.custom_definition_id,
        catalog_entry_version=record.catalog_entry_version,
        server_name=record.server_name,
        enabled=record.enabled,
        settings_json=record.settings_json,
        config_version=record.config_version,
        payload_ciphertext=record.payload_ciphertext,
        payload_format=record.payload_format,
        created_at=record.created_at,
        updated_at=record.updated_at,
        last_synced_at=record.last_synced_at,
        auth=_auth_record(await _load_auth(db, record.id)),
    )


async def _get_connection_orm(
    db: AsyncSession,
    user_id: UUID,
    connection_id: str,
) -> CloudMcpConnection | None:
    return (
        await db.execute(
            select(CloudMcpConnection).where(
                CloudMcpConnection.user_id == user_id,
                CloudMcpConnection.connection_id == connection_id,
            )
        )
    ).scalar_one_or_none()


async def list_user_connections(user_id: UUID) -> list[CloudMcpConnectionRecord]:
    async with db_engine.async_session_factory() as db:
        records = list(
            (
                await db.execute(
                    select(CloudMcpConnection)
                    .where(CloudMcpConnection.user_id == user_id)
                    .order_by(CloudMcpConnection.updated_at.desc())
                )
            )
            .scalars()
            .all()
        )
        return [await _connection_record(db, record) for record in records]


async def get_user_connection(
    user_id: UUID,
    connection_id: str,
) -> CloudMcpConnectionRecord | None:
    async with db_engine.async_session_factory() as db:
        record = await _get_connection_orm(db, user_id, connection_id)
        if record is None:
            return None
        return await _connection_record(db, record)


async def get_user_connection_by_db_id(
    user_id: UUID,
    connection_db_id: UUID,
) -> CloudMcpConnectionRecord | None:
    async with db_engine.async_session_factory() as db:
        record = (
            await db.execute(
                select(CloudMcpConnection).where(
                    CloudMcpConnection.id == connection_db_id,
                    CloudMcpConnection.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if record is None:
            return None
        return await _connection_record(db, record)


async def upsert_user_connection(
    *,
    user_id: UUID,
    catalog_entry_id: str | None,
    catalog_entry_version: int,
    server_name: str,
    settings_json: str,
    custom_definition_db_id: UUID | None = None,
    connection_id: str | None = None,
    enabled: bool = True,
) -> CloudMcpConnectionRecord:
    async with db_engine.async_session_factory() as db:
        now = utcnow()
        connection = (
            await _get_connection_orm(db, user_id, connection_id)
            if connection_id is not None
            else None
        )
        if connection is None:
            connection = CloudMcpConnection(
                user_id=user_id,
                org_id=None,
                connection_id=connection_id or str(uuid.uuid4()),
                catalog_entry_id=catalog_entry_id,
                custom_definition_id=custom_definition_db_id,
                catalog_entry_version=catalog_entry_version,
                server_name=server_name,
                enabled=enabled,
                settings_json=settings_json,
                config_version=1,
                payload_ciphertext=None,
                payload_format="json-v1",
                created_at=now,
                updated_at=now,
                last_synced_at=now,
            )
            db.add(connection)
            await db.commit()
            await db.refresh(connection)
            return await _connection_record(db, connection)

        connection.catalog_entry_id = catalog_entry_id
        connection.custom_definition_id = custom_definition_db_id
        connection.catalog_entry_version = catalog_entry_version
        connection.server_name = server_name
        connection.enabled = enabled
        connection.settings_json = settings_json
        connection.config_version += 1
        connection.updated_at = now
        connection.last_synced_at = now
        await db.commit()
        await db.refresh(connection)
        return await _connection_record(db, connection)


async def patch_user_connection(
    *,
    user_id: UUID,
    connection_id: str,
    enabled: bool | None = None,
    settings_json: str | None = None,
    server_name: str | None = None,
    catalog_entry_version: int | None = None,
) -> CloudMcpConnectionRecord | None:
    async with db_engine.async_session_factory() as db:
        connection = await _get_connection_orm(db, user_id, connection_id)
        if connection is None:
            return None
        changed = False
        if enabled is not None and connection.enabled != enabled:
            connection.enabled = enabled
            changed = True
        if settings_json is not None and connection.settings_json != settings_json:
            connection.settings_json = settings_json
            changed = True
        if server_name is not None and connection.server_name != server_name:
            connection.server_name = server_name
            changed = True
        if (
            catalog_entry_version is not None
            and connection.catalog_entry_version != catalog_entry_version
        ):
            connection.catalog_entry_version = catalog_entry_version
            changed = True
        if changed:
            connection.config_version += 1
            connection.updated_at = utcnow()
        await db.commit()
        await db.refresh(connection)
        return await _connection_record(db, connection)


async def delete_user_connection(user_id: UUID, connection_id: str) -> None:
    async with db_engine.async_session_factory() as db:
        connection = await _get_connection_orm(db, user_id, connection_id)
        if connection is None:
            return
        await db.execute(
            delete(CloudMcpOAuthFlow).where(
                CloudMcpOAuthFlow.connection_db_id == connection.id,
                CloudMcpOAuthFlow.status == "active",
            )
        )
        await db.delete(connection)
        await db.commit()
