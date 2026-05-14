"""Proliferate Worker heartbeat and inventory persistence."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.targets import (
    CloudTargetInventory,
)
from proliferate.db.models.cloud.targets import (
    CloudTargetStatus as CloudTargetStatusRow,
)
from proliferate.utils.time import utcnow


async def upsert_target_status(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID | None,
    status_value: str,
    status_detail: str | None,
) -> None:
    now = utcnow()
    row = await db.get(CloudTargetStatusRow, target_id)
    if row is None:
        row = CloudTargetStatusRow(
            target_id=target_id,
            worker_id=worker_id,
            status=status_value,
            status_detail=status_detail,
            last_seen_at=now,
            last_heartbeat_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.worker_id = worker_id
        row.status = status_value
        row.status_detail = status_detail
        row.last_seen_at = now
        row.last_heartbeat_at = now
        row.updated_at = now
    await db.flush()


async def upsert_inventory(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID | None,
    os: str | None,
    arch: str | None,
    distro: str | None,
    shell: str | None,
    git_json: str | None,
    node_json: str | None,
    python_json: str | None,
    browser_json: str | None,
    capabilities_json: str | None,
    providers_json: str | None,
    mcp_json: str | None,
    raw_json: str | None,
) -> None:
    now = utcnow()
    row = await db.get(CloudTargetInventory, target_id)
    if row is None:
        row = CloudTargetInventory(
            target_id=target_id,
            worker_id=worker_id,
            os=os,
            arch=arch,
            distro=distro,
            shell=shell,
            git_json=git_json,
            node_json=node_json,
            python_json=python_json,
            browser_json=browser_json,
            capabilities_json=capabilities_json,
            providers_json=providers_json,
            mcp_json=mcp_json,
            raw_json=raw_json,
            updated_at=now,
        )
        db.add(row)
    else:
        row.worker_id = worker_id
        row.os = os
        row.arch = arch
        row.distro = distro
        row.shell = shell
        row.git_json = git_json
        row.node_json = node_json
        row.python_json = python_json
        row.browser_json = browser_json
        row.capabilities_json = capabilities_json
        row.providers_json = providers_json
        row.mcp_json = mcp_json
        row.raw_json = raw_json
        row.updated_at = now
    await db.flush()
