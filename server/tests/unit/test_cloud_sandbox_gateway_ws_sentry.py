"""Sentry user hygiene for the gateway WebSocket route.

WebSockets never pass through ``RequestTelemetryMiddleware`` (BaseHTTPMiddleware
only runs for HTTP), so the Sentry user set during gateway WebSocket auth must
be cleared at socket teardown by the route itself — otherwise the identity
bleeds into later, unrelated events handled on the same worker.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.integrations import sentry as sentry_integration
from proliferate.server.cloud.gateway import api as gateway_api


class _FakeSentrySdk:
    def __init__(self) -> None:
        self.user: dict[str, str] | None = None
        self.set_user_calls: list[dict[str, str] | None] = []

    def set_user(self, value: dict[str, str] | None) -> None:
        self.user = value
        self.set_user_calls.append(value)


@pytest.fixture()
def fake_sdk(monkeypatch: pytest.MonkeyPatch) -> _FakeSentrySdk:
    fake = _FakeSentrySdk()
    monkeypatch.setattr(settings, "sentry_dsn", "https://sentry.example/123")
    monkeypatch.setattr(settings, "telemetry_mode", "hosted_product")
    monkeypatch.setattr(sentry_integration, "sentry_sdk", fake)
    return fake


def _fake_websocket() -> WebSocket:
    class _FakeWebSocket:
        async def close(self, code: int | None = None) -> None:
            return None

    websocket = _FakeWebSocket()
    return cast(WebSocket, websocket)


@pytest.mark.asyncio
async def test_ws_route_clears_sentry_user_after_proxying(
    monkeypatch: pytest.MonkeyPatch, fake_sdk: _FakeSentrySdk
) -> None:
    user = SimpleNamespace(id=uuid4())

    async def _auth(*_args: object, **_kwargs: object) -> object:
        # Mirrors access.py: gateway auth binds the Sentry user.
        sentry_integration.set_server_sentry_user(user_id=str(user.id))
        return user

    async def _access(*_args: object, **_kwargs: object) -> object:
        return SimpleNamespace(upstream_base_url="http://up", upstream_token="tok")

    proxied: list[bool] = []

    async def _proxy(*_args: object, **_kwargs: object) -> None:
        # While the socket is being served, the user must be bound.
        assert fake_sdk.user == {"id": str(user.id)}
        proxied.append(True)

    monkeypatch.setattr(gateway_api, "authenticate_product_user_for_gateway_websocket", _auth)
    monkeypatch.setattr(gateway_api, "ensure_cloud_sandbox_gateway_access", _access)
    monkeypatch.setattr(gateway_api, "proxy_websocket_to_anyharness", _proxy)
    monkeypatch.setattr(gateway_api, "product_token_from_websocket", lambda _ws: "token")
    monkeypatch.setattr(gateway_api, "accepted_gateway_websocket_subprotocol", lambda _ws: None)

    await gateway_api.proxy_cloud_sandbox_anyharness_websocket(
        _fake_websocket(), "some/path", cast(AsyncSession, object())
    )

    assert proxied == [True]
    # Teardown cleared the user so it cannot leak into the next event.
    assert fake_sdk.user is None
    assert fake_sdk.set_user_calls[-1] is None


@pytest.mark.asyncio
async def test_ws_route_clears_sentry_user_when_proxy_raises(
    monkeypatch: pytest.MonkeyPatch, fake_sdk: _FakeSentrySdk
) -> None:
    user = SimpleNamespace(id=uuid4())

    async def _auth(*_args: object, **_kwargs: object) -> object:
        sentry_integration.set_server_sentry_user(user_id=str(user.id))
        return user

    async def _access(*_args: object, **_kwargs: object) -> object:
        return SimpleNamespace(upstream_base_url="http://up", upstream_token="tok")

    async def _proxy(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("socket blew up")

    monkeypatch.setattr(gateway_api, "authenticate_product_user_for_gateway_websocket", _auth)
    monkeypatch.setattr(gateway_api, "ensure_cloud_sandbox_gateway_access", _access)
    monkeypatch.setattr(gateway_api, "proxy_websocket_to_anyharness", _proxy)
    monkeypatch.setattr(gateway_api, "product_token_from_websocket", lambda _ws: "token")
    monkeypatch.setattr(gateway_api, "accepted_gateway_websocket_subprotocol", lambda _ws: None)

    with pytest.raises(RuntimeError):
        await gateway_api.proxy_cloud_sandbox_anyharness_websocket(
            _fake_websocket(), "some/path", cast(AsyncSession, object())
        )

    assert fake_sdk.user is None


@pytest.mark.asyncio
async def test_ws_route_clears_sentry_user_on_auth_failure(
    monkeypatch: pytest.MonkeyPatch, fake_sdk: _FakeSentrySdk
) -> None:
    # Auth may set the user before failing a later gate (e.g. readiness);
    # the early-return close path must still clear it.
    async def _auth(*_args: object, **_kwargs: object) -> object:
        sentry_integration.set_server_sentry_user(user_id="half-authed-user")
        raise gateway_api.GatewayWebSocketAuthError("nope")

    monkeypatch.setattr(gateway_api, "authenticate_product_user_for_gateway_websocket", _auth)
    monkeypatch.setattr(gateway_api, "product_token_from_websocket", lambda _ws: "token")

    await gateway_api.proxy_cloud_sandbox_anyharness_websocket(
        _fake_websocket(), "some/path", cast(AsyncSession, object())
    )

    assert fake_sdk.user is None
