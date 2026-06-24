"""Product-user authentication helpers for gateway WebSockets."""

from __future__ import annotations

from typing import cast
from uuid import UUID

from fastapi import WebSocket
from fastapi_users.db import BaseUserDatabase
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import get_account_readiness
from proliferate.auth.jwt import get_jwt_strategy
from proliferate.auth.users import UserManager
from proliferate.db.models.auth import OAuthAccount, User
from proliferate.integrations.sentry import set_server_sentry_user
from proliferate.middleware.request_context import set_authenticated_user_context
from proliferate.rls_context import set_rls_actor_context


class GatewayWebSocketAuthError(Exception):
    """Raised when a gateway WebSocket cannot authenticate the product user."""


def product_token_from_websocket(websocket: WebSocket) -> str | None:
    token = websocket.query_params.get("access_token")
    if token:
        return token
    authorization = websocket.headers.get("authorization")
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value:
        return None
    return value


async def authenticate_product_user_for_gateway_websocket(
    db: AsyncSession,
    token: str | None,
) -> User:
    if not token:
        raise GatewayWebSocketAuthError("Missing gateway access token.")

    user_db = cast(
        BaseUserDatabase[User, UUID],
        SQLAlchemyUserDatabase(db, User, OAuthAccount),
    )
    user_manager = UserManager(user_db)
    user = cast(User | None, await get_jwt_strategy().read_token(token, user_manager))
    if user is None or not user.is_active:
        raise GatewayWebSocketAuthError("Invalid gateway access token.")

    readiness = await get_account_readiness(db, user_id=user.id)
    if not readiness.product_ready:
        raise GatewayWebSocketAuthError("GitHub must be connected before gateway access.")

    set_authenticated_user_context(str(user.id))
    set_rls_actor_context(user.id)
    set_server_sentry_user(user_id=str(user.id))
    return user
