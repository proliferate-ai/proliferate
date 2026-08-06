"""Worker-facing Product Engagement orchestration."""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.constants.product_engagement import (
    CUSTOMERIO_ENGAGEMENT_SYNC_PAGE_SIZE,
)
from proliferate.db.store.analytics import list_latest_client_activity
from proliferate.db.store.auth_identities import list_latest_auth_logins
from proliferate.db.store.cloud_workspaces import list_active_workspace_counts
from proliferate.db.store.users import list_engagement_sync_users_page
from proliferate.integrations.customerio import derive_email_type, push_user_attributes

logger = logging.getLogger(__name__)


async def run_customerio_engagement_sync(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Keyset-paginate users and push their engagement profile attributes."""

    total_users = 0
    total_pushed = 0
    last_id: UUID | None = None

    while True:
        async with session_factory() as db:
            users = await list_engagement_sync_users_page(
                db,
                after_id=last_id,
                limit=CUSTOMERIO_ENGAGEMENT_SYNC_PAGE_SIZE,
            )
            if not users:
                break

            user_ids = tuple(user.id for user in users)
            workspace_counts = await list_active_workspace_counts(
                db,
                owner_user_ids=user_ids,
            )
            activities = await list_latest_client_activity(
                db,
                actor_user_ids=user_ids,
            )
            logins = await list_latest_auth_logins(db, user_ids=user_ids)

        workspace_count_by_user = {
            value.owner_user_id: value.workspace_count for value in workspace_counts
        }
        activity_by_user = {value.actor_user_id: value.last_seen_at for value in activities}
        login_by_user = {
            value.user_id: value.last_login_at
            for value in logins
            if value.last_login_at is not None
        }

        total_users += len(users)
        for user in users:
            candidates = [
                value
                for value in (
                    activity_by_user.get(user.id),
                    login_by_user.get(user.id),
                )
                if value is not None
            ]
            last_active_at = max(candidates) if candidates else None
            attributes: dict[str, object] = {
                "workspace_count": workspace_count_by_user.get(user.id, 0),
                "email_type": derive_email_type(user.email),
            }
            if last_active_at is not None:
                attributes["last_active_at"] = int(last_active_at.timestamp())

            if await push_user_attributes(user_id=str(user.id), attributes=attributes):
                total_pushed += 1

        last_id = users[-1].id

    logger.info(
        "Customer.io engagement sync complete: %d users processed, %d pushed successfully",
        total_users,
        total_pushed,
    )
