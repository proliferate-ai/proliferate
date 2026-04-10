"""Persistence helpers for cloud MCP connection replicas."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.models.cloud import CloudMcpConnection
from proliferate.utils.time import utcnow


async def list_cloud_mcp_connections(
    db: AsyncSession,
    user_id: UUID,
) -> list[CloudMcpConnection]:
    return list(
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


async def get_cloud_mcp_connection(
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


async def upsert_cloud_mcp_connection(
    db: AsyncSession,
    *,
    user_id: UUID,
    connection_id: str,
    catalog_entry_id: str,
    payload_ciphertext: str,
    payload_format: str = "json-v1",
) -> CloudMcpConnection:
    existing = await get_cloud_mcp_connection(db, user_id, connection_id)
    now = utcnow()
    if existing is None:
        record = CloudMcpConnection(
            user_id=user_id,
            connection_id=connection_id,
            catalog_entry_id=catalog_entry_id,
            payload_ciphertext=payload_ciphertext,
            payload_format=payload_format,
            created_at=now,
            updated_at=now,
            last_synced_at=now,
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)
        return record

    existing.catalog_entry_id = catalog_entry_id
    existing.payload_ciphertext = payload_ciphertext
    existing.payload_format = payload_format
    existing.updated_at = now
    existing.last_synced_at = now
    await db.commit()
    await db.refresh(existing)
    return existing


async def delete_cloud_mcp_connection(
    db: AsyncSession,
    user_id: UUID,
    connection_id: str,
) -> None:
    await db.execute(
        delete(CloudMcpConnection).where(
            CloudMcpConnection.user_id == user_id,
            CloudMcpConnection.connection_id == connection_id,
        )
    )
    await db.commit()


async def load_cloud_mcp_connections_for_user(user_id: UUID) -> list[CloudMcpConnection]:
    async with db_engine.async_session_factory() as db:
        return await list_cloud_mcp_connections(db, user_id)


async def persist_cloud_mcp_connection_sync(
    *,
    user_id: UUID,
    connection_id: str,
    catalog_entry_id: str,
    payload_ciphertext: str,
    payload_format: str = "json-v1",
) -> CloudMcpConnection:
    async with db_engine.async_session_factory() as db:
        return await upsert_cloud_mcp_connection(
            db,
            user_id=user_id,
            connection_id=connection_id,
            catalog_entry_id=catalog_entry_id,
            payload_ciphertext=payload_ciphertext,
            payload_format=payload_format,
        )


async def persist_cloud_mcp_connection_delete(
    *,
    user_id: UUID,
    connection_id: str,
) -> None:
    async with db_engine.async_session_factory() as db:
        await delete_cloud_mcp_connection(db, user_id, connection_id)
