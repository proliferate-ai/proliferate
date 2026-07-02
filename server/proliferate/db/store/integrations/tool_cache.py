"""Persistence helpers for cached ``tools/list`` schemas per account.

One row per account (account_id PK) snapshotting the tool schema fetched under
a given auth_version; a version mismatch means the cache is stale.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudIntegrationToolSchemaCache
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class ToolSchemaCacheRecord:
    account_id: UUID
    auth_version: int
    tools_json: str
    content_hash: str | None
    status: str
    fetched_at: datetime | None
    error_code: str | None
    created_at: datetime
    updated_at: datetime


def _record(cache: CloudIntegrationToolSchemaCache) -> ToolSchemaCacheRecord:
    return ToolSchemaCacheRecord(
        account_id=cache.account_id,
        auth_version=cache.auth_version,
        tools_json=cache.tools_json,
        content_hash=cache.content_hash,
        status=cache.status,
        fetched_at=cache.fetched_at,
        error_code=cache.error_code,
        created_at=cache.created_at,
        updated_at=cache.updated_at,
    )


async def get_tool_cache(
    db: AsyncSession,
    account_id: UUID,
) -> ToolSchemaCacheRecord | None:
    cache = (
        await db.execute(
            select(CloudIntegrationToolSchemaCache).where(
                CloudIntegrationToolSchemaCache.account_id == account_id
            )
        )
    ).scalar_one_or_none()
    return _record(cache) if cache is not None else None


async def upsert_tool_cache(
    db: AsyncSession,
    *,
    account_id: UUID,
    auth_version: int,
    tools_json: str,
    content_hash: str | None,
    status: str,
    fetched_at: datetime | None,
    error_code: str | None,
) -> ToolSchemaCacheRecord:
    cache = (
        await db.execute(
            select(CloudIntegrationToolSchemaCache)
            .where(CloudIntegrationToolSchemaCache.account_id == account_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if cache is None:
        cache = CloudIntegrationToolSchemaCache(
            account_id=account_id,
            auth_version=auth_version,
            tools_json=tools_json,
            content_hash=content_hash,
            status=status,
            fetched_at=fetched_at,
            error_code=error_code,
            created_at=now,
            updated_at=now,
        )
        db.add(cache)
    else:
        cache.auth_version = auth_version
        cache.tools_json = tools_json
        cache.content_hash = content_hash
        cache.status = status
        cache.fetched_at = fetched_at
        cache.error_code = error_code
        cache.updated_at = now
    await db.flush()
    await db.refresh(cache)
    return _record(cache)


async def mark_tool_cache_stale(
    db: AsyncSession,
    account_id: UUID,
) -> ToolSchemaCacheRecord | None:
    cache = (
        await db.execute(
            select(CloudIntegrationToolSchemaCache)
            .where(CloudIntegrationToolSchemaCache.account_id == account_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if cache is None:
        return None
    cache.status = "stale"
    cache.updated_at = utcnow()
    await db.flush()
    await db.refresh(cache)
    return _record(cache)


async def delete_tool_cache(
    db: AsyncSession,
    account_id: UUID,
) -> None:
    """Delete the tool-schema cache row for ``account_id`` (no-op if absent).

    The cache keys on ``account_id`` with no FK cascade, so account deletion
    must clear this row explicitly.
    """
    await db.execute(
        delete(CloudIntegrationToolSchemaCache).where(
            CloudIntegrationToolSchemaCache.account_id == account_id
        )
    )
    await db.flush()
