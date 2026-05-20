from __future__ import annotations

import uuid
from uuid import UUID

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.mcp import (
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
        owner_scope=record.owner_scope,
        owner_user_id=record.owner_user_id,
        organization_id=record.organization_id,
        connection_id=record.connection_id,
        catalog_entry_id=record.catalog_entry_id,
        catalog_entry_version=record.catalog_entry_version,
        server_name=record.server_name,
        enabled=record.enabled,
        public_to_org=record.public_to_org,
        public_organization_id=record.public_organization_id,
        public_status=record.public_status,
        public_updated_at=record.public_updated_at,
        public_updated_by_user_id=record.public_updated_by_user_id,
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
                CloudMcpConnection.owner_scope == "personal",
                CloudMcpConnection.owner_user_id == user_id,
                CloudMcpConnection.connection_id == connection_id,
            )
        )
    ).scalar_one_or_none()


async def list_user_connections(
    db: AsyncSession,
    user_id: UUID,
) -> list[CloudMcpConnectionRecord]:
    records = list(
        (
            await db.execute(
                select(CloudMcpConnection)
                .where(
                    CloudMcpConnection.owner_scope == "personal",
                    CloudMcpConnection.owner_user_id == user_id,
                )
                .order_by(CloudMcpConnection.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [await _connection_record(db, record) for record in records]


async def get_user_connection(
    db: AsyncSession,
    user_id: UUID,
    connection_id: str,
) -> CloudMcpConnectionRecord | None:
    record = await _get_connection_orm(db, user_id, connection_id)
    if record is None:
        return None
    return await _connection_record(db, record)


async def get_user_connection_by_db_id(
    db: AsyncSession,
    user_id: UUID,
    connection_db_id: UUID,
) -> CloudMcpConnectionRecord | None:
    record = (
        await db.execute(
            select(CloudMcpConnection).where(
                CloudMcpConnection.id == connection_db_id,
                CloudMcpConnection.owner_scope == "personal",
                CloudMcpConnection.owner_user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if record is None:
        return None
    return await _connection_record(db, record)


async def upsert_user_connection(
    db: AsyncSession,
    *,
    user_id: UUID,
    catalog_entry_id: str,
    catalog_entry_version: int,
    server_name: str,
    settings_json: str,
    connection_id: str | None = None,
    enabled: bool = True,
) -> CloudMcpConnectionRecord:
    now = utcnow()
    connection = (
        await _get_connection_orm(db, user_id, connection_id)
        if connection_id is not None
        else None
    )
    if connection is None:
        connection = CloudMcpConnection(
            owner_scope="personal",
            owner_user_id=user_id,
            organization_id=None,
            connection_id=connection_id or str(uuid.uuid4()),
            catalog_entry_id=catalog_entry_id,
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
        await db.flush()
        await db.refresh(connection)
        return await _connection_record(db, connection)

    connection.catalog_entry_id = catalog_entry_id
    connection.catalog_entry_version = catalog_entry_version
    connection.server_name = server_name
    connection.enabled = enabled
    connection.settings_json = settings_json
    connection.config_version += 1
    connection.updated_at = now
    connection.last_synced_at = now
    await db.flush()
    await db.refresh(connection)
    return await _connection_record(db, connection)


async def patch_user_connection(
    db: AsyncSession,
    *,
    user_id: UUID,
    connection_id: str,
    enabled: bool | None = None,
    settings_json: str | None = None,
    server_name: str | None = None,
    catalog_entry_version: int | None = None,
    public_to_org: bool | None = None,
    public_organization_id: UUID | None = None,
    public_status: str | None = None,
    public_updated_by_user_id: UUID | None = None,
) -> CloudMcpConnectionRecord | None:
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
    if public_to_org is not None and connection.public_to_org != public_to_org:
        connection.public_to_org = public_to_org
        changed = True
    if public_organization_id != connection.public_organization_id:
        connection.public_organization_id = public_organization_id
        changed = True
    if public_status is not None and connection.public_status != public_status:
        connection.public_status = public_status
        changed = True
    if public_updated_by_user_id != connection.public_updated_by_user_id:
        connection.public_updated_by_user_id = public_updated_by_user_id
        changed = True
    if changed:
        if public_to_org is not None or public_status is not None:
            connection.public_updated_at = utcnow()
        connection.config_version += 1
        connection.updated_at = utcnow()
    await db.flush()
    await db.refresh(connection)
    return await _connection_record(db, connection)


async def delete_user_connection(
    db: AsyncSession,
    user_id: UUID,
    connection_id: str,
) -> None:
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
    await db.flush()


async def list_enabled_connections_for_personal_profile(
    db: AsyncSession,
    user_id: UUID,
) -> tuple[CloudMcpConnectionRecord, ...]:
    records = list(
        (
            await db.execute(
                select(CloudMcpConnection)
                .where(
                    CloudMcpConnection.owner_scope == "personal",
                    CloudMcpConnection.owner_user_id == user_id,
                    CloudMcpConnection.enabled.is_(True),
                )
                .order_by(CloudMcpConnection.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return tuple([await _connection_record(db, record) for record in records])


async def list_enabled_connections_for_organization_profile(
    db: AsyncSession,
    organization_id: UUID,
) -> tuple[CloudMcpConnectionRecord, ...]:
    records = list(
        (
            await db.execute(
                select(CloudMcpConnection)
                .where(
                    CloudMcpConnection.enabled.is_(True),
                    or_(
                        (
                            (CloudMcpConnection.owner_scope == "organization")
                            & (CloudMcpConnection.organization_id == organization_id)
                        ),
                        (
                            (CloudMcpConnection.public_to_org.is_(True))
                            & (CloudMcpConnection.public_organization_id == organization_id)
                            & (CloudMcpConnection.public_status == "public")
                        ),
                    ),
                )
                .order_by(CloudMcpConnection.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return tuple([await _connection_record(db, record) for record in records])
