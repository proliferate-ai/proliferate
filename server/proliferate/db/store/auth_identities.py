"""Persistence reads for canonical external authentication identities."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import AuthIdentity


@dataclass(frozen=True)
class LatestAuthLoginValue:
    user_id: UUID
    last_login_at: datetime | None


async def list_latest_auth_logins(
    db: AsyncSession,
    *,
    user_ids: tuple[UUID, ...],
) -> tuple[LatestAuthLoginValue, ...]:
    if not user_ids:
        return ()
    rows = (
        await db.execute(
            select(
                AuthIdentity.user_id,
                func.max(AuthIdentity.last_login_at).label("last_login_at"),
            )
            .where(AuthIdentity.user_id.in_(user_ids))
            .group_by(AuthIdentity.user_id)
        )
    ).all()
    return tuple(
        LatestAuthLoginValue(
            user_id=row.user_id,
            last_login_at=row.last_login_at,
        )
        for row in rows
    )
