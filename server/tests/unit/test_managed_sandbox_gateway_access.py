from __future__ import annotations

from typing import cast

from fastapi import WebSocket
from starlette.datastructures import Headers, QueryParams

from proliferate.server.cloud.gateway.access import (
    GATEWAY_WEBSOCKET_BEARER_PROTOCOL,
    accepted_gateway_websocket_subprotocol,
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
        sec_websocket_protocol=(
            f"{GATEWAY_WEBSOCKET_BEARER_PROTOCOL}, product-token"
        ),
    )

    assert product_token_from_websocket(websocket) == "product-token"
    assert accepted_gateway_websocket_subprotocol(websocket) == (
        GATEWAY_WEBSOCKET_BEARER_PROTOCOL
    )


def test_product_token_from_websocket_keeps_legacy_query_support() -> None:
    websocket = _websocket(
        query="access_token=query-token",
        sec_websocket_protocol=(
            f"{GATEWAY_WEBSOCKET_BEARER_PROTOCOL}, protocol-token"
        ),
    )

    assert product_token_from_websocket(websocket) == "query-token"


def test_product_token_from_websocket_supports_authorization_header() -> None:
    websocket = _websocket(authorization="Bearer header-token")

    assert product_token_from_websocket(websocket) == "header-token"
