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
from proliferate.config import settings
from proliferate.db.models.auth import OAuthAccount, User
from proliferate.integrations.sentry import set_server_sentry_user
from proliferate.middleware.request_context import set_authenticated_user_context
from proliferate.rls_context import set_rls_actor_context


class GatewayWebSocketAuthError(Exception):
    """Raised when a gateway WebSocket cannot authenticate the product user."""


GATEWAY_WEBSOCKET_BEARER_PROTOCOL = "proliferate-gateway-bearer"


def _websocket_protocol_values(websocket: WebSocket) -> list[str]:
    header = websocket.headers.get("sec-websocket-protocol")
    if not header:
        return []
    return [value.strip() for value in header.split(",") if value.strip()]


def product_token_from_websocket_protocol(websocket: WebSocket) -> str | None:
    protocols = _websocket_protocol_values(websocket)
    try:
        marker_index = protocols.index(GATEWAY_WEBSOCKET_BEARER_PROTOCOL)
    except ValueError:
        return None
    token_index = marker_index + 1
    if token_index >= len(protocols):
        return None
    return protocols[token_index] or None


def accepted_gateway_websocket_subprotocol(websocket: WebSocket) -> str | None:
    protocols = _websocket_protocol_values(websocket)
    if GATEWAY_WEBSOCKET_BEARER_PROTOCOL in protocols:
        return GATEWAY_WEBSOCKET_BEARER_PROTOCOL
    return None


def product_token_from_websocket(websocket: WebSocket) -> str | None:
    token = websocket.query_params.get("access_token")
    if token:
        return token
    token = product_token_from_websocket_protocol(websocket)
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

    # This is the WebSocket sibling of the ``current_product_user`` HTTP gate,
    # so it carries the same single-org carve-out (see #1023). Hosted keeps the
    # GitHub product-readiness gate; single-org (self-hosted) instances admit
    # password-only accounts, because reaching your own cloud sandbox over the
    # gateway must work with no GitHub OAuth app configured. Endpoints that
    # genuinely need a GitHub token still enforce that at the point of use.
    if not settings.single_org_mode:
        readiness = await get_account_readiness(db, user_id=user.id)
        if not readiness.product_ready:
            raise GatewayWebSocketAuthError("GitHub must be connected before gateway access.")

    set_authenticated_user_context(str(user.id))
    set_rls_actor_context(user.id)
    set_server_sentry_user(user_id=str(user.id))
    return user
