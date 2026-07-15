from __future__ import annotations

from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import Headers, QueryParams

from proliferate.config import settings
from proliferate.server.cloud.gateway import access
from proliferate.server.cloud.gateway.access import (
    GATEWAY_WEBSOCKET_BEARER_PROTOCOL,
    GatewayWebSocketAuthError,
    accepted_gateway_websocket_subprotocol,
    authenticate_product_user_for_gateway_websocket,
    product_token_from_websocket,
)


def _websocket(
    *,
    query: str = "",
    sec_websocket_protocol: str | None = None,
    authorization: str | None = None,
) -> WebSocket:
    headers: dict[str, str] = {}
    if sec_websocket_protocol is not None:
        headers["sec-websocket-protocol"] = sec_websocket_protocol
    if authorization is not None:
        headers["authorization"] = authorization

    class _FakeWebSocket:
        pass

    websocket = _FakeWebSocket()
    websocket.query_params = QueryParams(query)
    websocket.headers = Headers(headers)
    return cast(WebSocket, websocket)


def test_product_token_from_websocket_protocol() -> None:
    websocket = _websocket(
        sec_websocket_protocol=(f"{GATEWAY_WEBSOCKET_BEARER_PROTOCOL}, product-token"),
    )

    assert product_token_from_websocket(websocket) == "product-token"
    assert accepted_gateway_websocket_subprotocol(websocket) == (GATEWAY_WEBSOCKET_BEARER_PROTOCOL)


def test_product_token_from_websocket_keeps_legacy_query_support() -> None:
    websocket = _websocket(
        query="access_token=query-token",
        sec_websocket_protocol=(f"{GATEWAY_WEBSOCKET_BEARER_PROTOCOL}, protocol-token"),
    )

    assert product_token_from_websocket(websocket) == "query-token"


def test_product_token_from_websocket_supports_authorization_header() -> None:
    websocket = _websocket(authorization="Bearer header-token")

    assert product_token_from_websocket(websocket) == "header-token"


def _patch_token_resolves_to(monkeypatch: pytest.MonkeyPatch, user: object) -> None:
    class _FakeJwtStrategy:
        async def read_token(self, _token: object, _user_manager: object) -> object:
            return user

    monkeypatch.setattr(access, "get_jwt_strategy", lambda: _FakeJwtStrategy())


class TestSingleOrgGatewayWebsocketBypass:
    """The gateway WebSocket auth mirrors current_product_user's single-org carve-out.

    This is the WebSocket sibling of the HTTP ``current_product_user`` gate
    fixed in #1023. Self-hosted single-org instances have no GitHub OAuth app
    configured, so a password-only account must be able to reach its own cloud
    sandbox over the gateway. Hosted keeps the GitHub product-readiness gate.
    """

    @pytest.mark.asyncio
    async def test_single_org_bypasses_product_ready_gate(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "single_org_mode_override", True)
        user = SimpleNamespace(id=uuid4(), is_active=True)
        _patch_token_resolves_to(monkeypatch, user)

        async def _readiness(*_args: object, **_kwargs: object) -> object:
            raise AssertionError("single-org mode must not consult product readiness")

        monkeypatch.setattr(access, "get_account_readiness", _readiness)

        resolved = await authenticate_product_user_for_gateway_websocket(
            cast(AsyncSession, object()),
            "product-token",
        )
        assert resolved is user

    @pytest.mark.asyncio
    async def test_hosted_mode_rejects_product_unready_user(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "single_org_mode_override", False)
        user = SimpleNamespace(id=uuid4(), is_active=True)
        _patch_token_resolves_to(monkeypatch, user)

        async def _readiness(*_args: object, **_kwargs: object) -> object:
            return SimpleNamespace(product_ready=False)

        monkeypatch.setattr(access, "get_account_readiness", _readiness)

        with pytest.raises(GatewayWebSocketAuthError):
            await authenticate_product_user_for_gateway_websocket(
                cast(AsyncSession, object()),
                "product-token",
            )

    @pytest.mark.asyncio
    async def test_hosted_mode_allows_product_ready_user(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "single_org_mode_override", False)
        user = SimpleNamespace(id=uuid4(), is_active=True)
        _patch_token_resolves_to(monkeypatch, user)

        async def _readiness(*_args: object, **_kwargs: object) -> object:
            return SimpleNamespace(product_ready=True)

        monkeypatch.setattr(access, "get_account_readiness", _readiness)

        resolved = await authenticate_product_user_for_gateway_websocket(
            cast(AsyncSession, object()),
            "product-token",
        )
        assert resolved is user
