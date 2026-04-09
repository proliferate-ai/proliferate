"""DB adapter for fastapi-users and user lookup store helpers."""

from collections.abc import AsyncGenerator
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from proliferate.db import engine as db_engine
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import (
    OAuthAccount,
    User,
)


async def get_user_db(
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> AsyncGenerator[SQLAlchemyUserDatabase[User, OAuthAccount], None]:
    yield SQLAlchemyUserDatabase(session, User, OAuthAccount)


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
            select(User).options(selectinload(User.oauth_accounts)).where(User.id == user_id)
        )
    ).scalar_one_or_none()


async def load_user_by_id(user_id: UUID) -> User | None:
    async with db_engine.async_session_factory() as db:
        return await get_user_by_id(db, user_id)


async def load_active_user_by_id(user_id: UUID) -> User | None:
    async with db_engine.async_session_factory() as db:
        return await get_active_user_by_id(db, user_id)


async def load_user_with_oauth_accounts_by_id(user_id: UUID) -> User | None:
    async with db_engine.async_session_factory() as db:
        return await get_user_with_oauth_accounts_by_id(db, user_id)
