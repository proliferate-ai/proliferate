"""Temporary credential readers for flows that do not yet thread request DB."""

from __future__ import annotations

from uuid import UUID

from proliferate.db.engine import async_session_factory
from proliferate.db.store.cloud_credentials import (
    CloudCredentialRecord,
    get_user_cloud_credentials,
)


async def load_cloud_credentials_for_user(user_id: UUID) -> list[CloudCredentialRecord]:
    async with async_session_factory() as db:
        return await get_user_cloud_credentials(db, user_id)
