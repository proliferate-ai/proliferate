from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudIntegrationToolSchemaCache
from proliferate.db.store.cloud_integrations.types import IntegrationToolSchemaCacheRecord
from proliferate.utils.time import utcnow


def _cache_record(row: CloudIntegrationToolSchemaCache) -> IntegrationToolSchemaCacheRecord:
    return IntegrationToolSchemaCacheRecord(
        id=row.id,
        account_id=row.account_id,
        cache_key=row.cache_key,
        tools_json=row.tools_json,
        status=row.status,
        refreshed_at=row.refreshed_at,
        last_error_code=row.last_error_code,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def get_tool_schema_cache(
    db: AsyncSession,
    *,
    account_id: UUID,
    cache_key: str,
) -> IntegrationToolSchemaCacheRecord | None:
    row = (
        await db.execute(
            select(CloudIntegrationToolSchemaCache).where(
                CloudIntegrationToolSchemaCache.account_id == account_id,
                CloudIntegrationToolSchemaCache.cache_key == cache_key,
            )
        )
    ).scalar_one_or_none()
    return _cache_record(row) if row is not None else None


async def upsert_tool_schema_cache(
    db: AsyncSession,
    *,
    account_id: UUID,
    cache_key: str,
    tools_json: str,
    status: str,
    last_error_code: str | None = None,
) -> IntegrationToolSchemaCacheRecord:
    row = (
        await db.execute(
            select(CloudIntegrationToolSchemaCache).where(
                CloudIntegrationToolSchemaCache.account_id == account_id,
                CloudIntegrationToolSchemaCache.cache_key == cache_key,
            )
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = CloudIntegrationToolSchemaCache(
            account_id=account_id,
            cache_key=cache_key,
            tools_json=tools_json,
            status=status,
            refreshed_at=now if status == "ready" else None,
            last_error_code=last_error_code,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.tools_json = tools_json
        row.status = status
        row.refreshed_at = now if status == "ready" else row.refreshed_at
        row.last_error_code = last_error_code
        row.updated_at = now
    await db.flush()
    await db.refresh(row)
    return _cache_record(row)


async def mark_tool_schema_cache_stale(
    db: AsyncSession,
    *,
    account_id: UUID,
) -> int:
    rows = (
        (
            await db.execute(
                select(CloudIntegrationToolSchemaCache).where(
                    CloudIntegrationToolSchemaCache.account_id == account_id
                )
            )
        )
        .scalars()
        .all()
    )
    now = utcnow()
    for row in rows:
        row.status = "stale"
        row.updated_at = now
    await db.flush()
    return len(rows)
