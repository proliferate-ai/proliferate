"""Reusable FastAPI dependency for getting the current authenticated user."""

import uuid

from fastapi import Depends
from fastapi_users import FastAPIUsers

from proliferate.auth.jwt import auth_backend
from proliferate.auth.users import get_user_manager
from proliferate.db.models.auth import User
from proliferate.integrations.sentry import set_server_sentry_user

fastapi_users = FastAPIUsers[User, uuid.UUID](
    get_user_manager,
    [auth_backend],
)

_current_active_user = fastapi_users.current_user(active=True)


async def current_active_user(
    user: User = Depends(_current_active_user),
) -> User:
    set_server_sentry_user(
        user_id=str(user.id),
        email=user.email,
        display_name=user.display_name,
    )
    return user
