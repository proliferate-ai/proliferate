"""Reusable FastAPI dependency for getting the current authenticated user."""

import uuid

from fastapi import Depends
from fastapi_users import FastAPIUsers

from proliferate.auth.identity import user_has_product_identity
from proliferate.auth.jwt import auth_backend
from proliferate.auth.users import get_user_manager
from proliferate.db.models.auth import User
from proliferate.errors import PermissionDenied
from proliferate.integrations.sentry import set_server_sentry_user

fastapi_users = FastAPIUsers[User, uuid.UUID](
    get_user_manager,
    [auth_backend],
)

_current_active_user = fastapi_users.current_user(active=True)


async def current_active_user(
    user: User = Depends(_current_active_user),
) -> User:
    set_server_sentry_user(user_id=str(user.id))
    return user


async def current_limited_user(
    user: User = Depends(current_active_user),
) -> User:
    return user


async def current_product_user(
    user: User = Depends(current_limited_user),
) -> User:
    if not user_has_product_identity(user):
        raise PermissionDenied(
            "Connect GitHub before using Proliferate Cloud product surfaces.",
            code="github_link_required",
        )
    return user
