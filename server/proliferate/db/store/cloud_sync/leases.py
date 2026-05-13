"""Persistence helpers for command lease maintenance."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.commands import CloudCommand, CloudCommandLease


async def recover_expired_command_leases(
    db: AsyncSession,
    *,
    now: datetime,
) -> int:
    rows = await db.execute(
        select(CloudCommandLease)
        .where(
            CloudCommandLease.status == "active",
            CloudCommandLease.expires_at <= now,
        )
        .with_for_update(skip_locked=True)
    )
    recovered = 0
    for lease in rows.scalars().all():
        command = await db.get(CloudCommand, lease.command_id)
        lease.status = "expired"
        lease.updated_at = now
        if command is not None and command.status == "leased":
            command.status = "queued"
            command.lease_expires_at = None
            command.updated_at = now
            recovered += 1
    await db.flush()
    return recovered
