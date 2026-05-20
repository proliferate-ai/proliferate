"""DB adapter for fastapi-users and user lookup store helpers."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from proliferate.db import engine as db_engine
from proliferate.db.models.auth import OAuthAccount, User


async def get_user_by_id(
    db: AsyncSession,
    user_id: UUID,
) -> User | None:
    return await db.get(User, user_id)


async def get_active_user_by_id(
    db: AsyncSession,
    user_id: UUID,
) -> User | None:
    user = await get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        return None
    return user


async def get_user_with_oauth_accounts_by_id(
    db: AsyncSession,
    user_id: UUID,
) -> User | None:
    return (
        await db.execute(
            select(User).options(selectinload(User.oauth_accounts)).filter_by(id=user_id)
        )
    ).scalar_one_or_none()


async def github_oauth_account_or_email_exists(
    db: AsyncSession,
    *,
    account_id: str,
    account_email: str,
) -> bool:
    account = (
        await db.execute(
            select(OAuthAccount.id)
            .where(
                OAuthAccount.oauth_name == "github",
                OAuthAccount.account_id == account_id,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if account is not None:
        return True
    normalized_email = account_email.strip().lower()
    user = (
        await db.execute(
            select(User.id).where(func.lower(User.email) == normalized_email).limit(1)
        )
    ).scalar_one_or_none()
    return user is not None


async def update_user_github_profile(
    db: AsyncSession,
    user_id: UUID,
    *,
    github_login: str,
    avatar_url: str | None,
    display_name: str | None,
) -> User | None:
    user = await get_user_by_id(db, user_id)
    if user is None:
        return None

    user.github_login = github_login
    user.avatar_url = avatar_url
    if display_name and not (user.display_name or "").strip():
        user.display_name = display_name
    return user


async def load_user_with_oauth_accounts_by_id(user_id: UUID) -> User | None:
    # Transitional isolated read for deferred runtime/mobility/worker flows.
    # Request-scoped callers should use get_user_with_oauth_accounts_by_id(db, ...).
    async with db_engine.async_session_factory() as db:
        return await get_user_with_oauth_accounts_by_id(db, user_id)
