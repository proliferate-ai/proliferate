"""Nightly Customer.io engagement attribute sync."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.background.celery_app import celery_app
from proliferate.background.config import CUSTOMERIO_ENGAGEMENT_SYNC_TASK
from proliferate.db.engine import async_session_factory
from proliferate.db.models.analytics import ClientDailyActivity
from proliferate.db.models.auth import AuthIdentity, User
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.integrations.customerio import derive_email_type, push_user_attributes

logger = logging.getLogger(__name__)

PAGE_SIZE = 500


async def _sync_page(
    db: AsyncSession,
    user_rows: list[tuple[UUID, str | None]],
) -> int:
    """Sync one page of users. Returns number of successful pushes."""
    if not user_rows:
        return 0

    user_ids = [uid for uid, _ in user_rows]

    # Workspace count per user (active, non-archived)
    workspace_counts_result = await db.execute(
        select(
            CloudWorkspace.owner_user_id,
            func.count(CloudWorkspace.id),
        )
        .where(
            CloudWorkspace.owner_user_id.in_(user_ids),
            CloudWorkspace.archived_at.is_(None),
        )
        .group_by(CloudWorkspace.owner_user_id)
    )
    workspace_counts: dict[UUID, int] = dict(workspace_counts_result.all())  # type: ignore[arg-type]

    # last_active_at = GREATEST of MAX(client_daily_activity.last_seen_at)
    # and MAX(auth_identity.last_login_at)
    activity_result = await db.execute(
        select(
            ClientDailyActivity.actor_user_id,
            func.max(ClientDailyActivity.last_seen_at),
        )
        .where(ClientDailyActivity.actor_user_id.in_(user_ids))
        .group_by(ClientDailyActivity.actor_user_id)
    )
    activity_map: dict[UUID, datetime] = {
        uid: last_seen for uid, last_seen in activity_result.all() if last_seen is not None
    }

    login_result = await db.execute(
        select(
            AuthIdentity.user_id,
            func.max(AuthIdentity.last_login_at),
        )
        .where(AuthIdentity.user_id.in_(user_ids))
        .group_by(AuthIdentity.user_id)
    )
    login_map: dict[UUID, datetime] = {
        uid: last_login for uid, last_login in login_result.all() if last_login is not None
    }

    pushed = 0
    for user_id, email in user_rows:
        # Derive last_active_at as GREATEST of activity and login
        candidates = [v for v in (activity_map.get(user_id), login_map.get(user_id)) if v]
        last_active_at = max(candidates) if candidates else None

        attributes: dict[str, Any] = {
            "workspace_count": workspace_counts.get(user_id, 0),
            "email_type": derive_email_type(email),
        }
        if last_active_at is not None:
            attributes["last_active_at"] = int(last_active_at.timestamp())

        ok = await push_user_attributes(user_id=str(user_id), attributes=attributes)
        if ok:
            pushed += 1

    return pushed


async def _run_engagement_sync() -> None:
    """Keyset-paginate all users and push engagement attributes to Customer.io."""
    total_users = 0
    total_pushed = 0
    last_id: UUID | None = None

    while True:
        async with async_session_factory() as db:
            query = select(User.id, User.email).order_by(User.id).limit(PAGE_SIZE)
            if last_id is not None:
                query = query.where(User.id > last_id)

            result = await db.execute(query)
            rows = result.all()

            if not rows:
                break

            total_users += len(rows)
            user_rows = [(row[0], row[1]) for row in rows]
            pushed = await _sync_page(db, user_rows)
            total_pushed += pushed
            last_id = user_rows[-1][0]

    logger.info(
        "Customer.io engagement sync complete: %d users processed, %d pushed successfully",
        total_users,
        total_pushed,
    )


@celery_app.task(name=CUSTOMERIO_ENGAGEMENT_SYNC_TASK)
def customerio_engagement_sync() -> str:
    asyncio.run(_run_engagement_sync())
    return "ok"
