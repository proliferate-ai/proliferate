"""Reusable FastAPI dependency for getting the current authenticated user."""

import uuid

from fastapi import Depends
from fastapi_users import FastAPIUsers
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import get_account_readiness
from proliferate.auth.jwt import auth_backend
from proliferate.auth.users import get_user_manager
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.errors import PermissionDenied
from proliferate.integrations.sentry import set_server_sentry_user
from proliferate.middleware.request_context import set_authenticated_user_context

fastapi_users = FastAPIUsers[User, uuid.UUID](
    get_user_manager,
    [auth_backend],
)

_current_active_user = fastapi_users.current_user(active=True)
_optional_current_active_user = fastapi_users.current_user(active=True, optional=True)


async def current_active_user(
    user: User = Depends(_current_active_user),
) -> User:
    set_authenticated_user_context(str(user.id))
    set_server_sentry_user(user_id=str(user.id))
    return user


async def current_limited_user(
    user: User = Depends(current_active_user),
) -> User:
    return user


async def current_product_user(
    user: User = Depends(current_limited_user),
    db: AsyncSession = Depends(get_async_session),
) -> User:
    readiness = await get_account_readiness(db, user_id=user.id)
    if not readiness.product_ready:
        raise PermissionDenied(
            "Connect GitHub before using Proliferate Cloud product surfaces.",
            code="github_link_required",
        )
    return user


async def optional_current_active_user(
    user: User | None = Depends(_optional_current_active_user),
) -> User | None:
    if user is not None:
        set_authenticated_user_context(str(user.id))
        set_server_sentry_user(user_id=str(user.id))
    return user
