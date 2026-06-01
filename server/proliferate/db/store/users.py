"""DB adapter for fastapi-users and user lookup store helpers."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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


async def claim_customerio_welcome_send(
    db: AsyncSession,
    user_id: UUID,
) -> bool:
    """Atomically claim the welcome-email send for ``user_id``.

    Sets ``customerio_welcome_sent_at`` only when it is currently NULL. Returns
    True when this caller won the claim, False when the welcome was already
    sent (or the user is missing).
    """
    now = datetime.now(UTC)
    result = await db.execute(
        update(User)
        .where(User.id == user_id)
        .where(User.customerio_welcome_sent_at.is_(None))
        .values(customerio_welcome_sent_at=now)
    )
    return (result.rowcount or 0) > 0


async def clear_customerio_welcome_send(
    db: AsyncSession,
    user_id: UUID,
) -> None:
    """Clear ``customerio_welcome_sent_at`` so a future attempt can retry."""
    await db.execute(
        update(User).where(User.id == user_id).values(customerio_welcome_sent_at=None)
    )


async def load_user_with_oauth_accounts_by_id(
    db: AsyncSession,
    user_id: UUID,
) -> User | None:
    return await get_user_with_oauth_accounts_by_id(db, user_id)
