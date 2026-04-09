from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import OAuthAccount


async def seed_linked_github_account(
    db_session: AsyncSession,
    *,
    user_id: str,
    access_token: str,
    account_id: str | None = None,
    account_email: str | None = None,
) -> None:
    account = OAuthAccount(
        user_id=uuid.UUID(user_id),
        oauth_name="github",
        access_token=access_token,
        account_id=account_id or f"gh-{uuid.uuid4().hex[:10]}",
        account_email=account_email or f"cloud-e2e-{uuid.uuid4().hex[:8]}@example.com",
    )
    db_session.add(account)
    await db_session.commit()


async def link_github_account(
    db_session: AsyncSession,
    *,
    user_id: str,
    access_token: str,
) -> None:
    await seed_linked_github_account(
        db_session,
        user_id=user_id,
        access_token=access_token,
    )
