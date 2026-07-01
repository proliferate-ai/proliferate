from __future__ import annotations

from typing import cast

import httpx
import pytest
from fastapi import Request, WebSocket
from starlette.datastructures import QueryParams

from proliferate.server.cloud.gateway import proxy


def _request(body: bytes = b"payload") -> Request:
    async def receive() -> dict[str, object]:
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/v1/gateway/cloud-sandbox/anyharness/v1/sessions/ws%2Fencoded",
            "raw_path": b"/v1/gateway/cloud-sandbox/anyharness/v1/sessions/ws%2Fencoded",
            "query_string": b"cursor=abc&access_token=product-token&repeat=1&repeat=2",
            "headers": [
                (b"authorization", b"Bearer product-token"),
                (b"cookie", b"session=product-cookie"),
                (b"host", b"api.example.test"),
                (b"connection", b"upgrade"),
                (b"content-length", b"999"),
                (b"x-client-header", b"kept"),
            ],
        },
        receive,
    )


@pytest.mark.asyncio
async def test_http_proxy_preserves_path_query_and_injects_sandbox_auth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created: dict[str, _FakeAsyncClient] = {}

    class _FakeAsyncClient:
        sent_request: httpx.Request | None
        forwarded_headers: dict[str, str] | None
        closed: bool

        def __init__(self, *_args: object, **_kwargs: object) -> None:
            self.sent_request = None
            self.forwarded_headers = None
            self.closed = False
            created["client"] = self

        def build_request(
            self,
            method: str,
            url: str,
            *,
            headers: dict[str, str],
            content: bytes,
        ) -> httpx.Request:
            self.forwarded_headers = headers
            return httpx.Request(method, url, headers=headers, content=content)

        async def send(
            self,
            request: httpx.Request,
            *,
            stream: bool,
        ) -> httpx.Response:
            assert stream is True
            self.sent_request = request
            return httpx.Response(
                200,
                headers={
                    "content-type": "text/event-stream",
                    "transfer-encoding": "chunked",
                    "x-upstream": "kept",
                },
                stream=httpx.ByteStream(b"event: one\n\n"),
                request=request,
            )

        async def aclose(self) -> None:
            self.closed = True

    monkeypatch.setattr(proxy.httpx, "AsyncClient", _FakeAsyncClient)

    response = await proxy.proxy_http_to_anyharness(
        _request(),
        upstream_base_url="https://sandbox.example.test",
        upstream_token="sandbox-token",
        path="v1/sessions/ws/encoded",
    )
    body = b"".join([chunk async for chunk in response.body_iterator])
    if response.background is not None:
        await response.background()

    client = created["client"]
    assert client.sent_request is not None
    assert client.sent_request.method == "POST"
    assert str(client.sent_request.url) == (
        "https://sandbox.example.test/v1/sessions/ws%2Fencoded?cursor=abc&repeat=1&repeat=2"
    )
    assert client.sent_request.content == b"payload"
    assert client.forwarded_headers is not None
    assert "cookie" not in client.forwarded_headers
    assert "host" not in client.forwarded_headers
    assert "connection" not in client.forwarded_headers
    assert "content-length" not in client.forwarded_headers
    assert client.sent_request.headers["authorization"] == "Bearer sandbox-token"
    assert client.sent_request.headers["x-client-header"] == "kept"
    assert "content-length" in client.sent_request.headers
    assert client.sent_request.headers["content-length"] == "7"
    assert response.headers["content-type"] == "text/event-stream"
    assert response.headers["x-upstream"] == "kept"
    assert "transfer-encoding" not in response.headers
    assert body == b"event: one\n\n"
    assert client.closed is True


def test_websocket_headers_strip_product_protocol_auth() -> None:
    forwarded = proxy._websocket_headers(
        {
            "sec-websocket-protocol": "proliferate-gateway-bearer, product-token",
            "x-client-header": "kept",
        }
    )

    assert forwarded == {"x-client-header": "kept"}


@pytest.mark.asyncio
async def test_http_proxy_returns_499_when_client_disconnects_before_forwarding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def receive() -> dict[str, object]:
        return {"type": "http.disconnect"}

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/v1/gateway/cloud-sandbox/anyharness/v1/sessions",
            "raw_path": b"/v1/gateway/cloud-sandbox/anyharness/v1/sessions",
            "query_string": b"",
            "headers": [],
        },
        receive,
    )

    class _UnexpectedAsyncClient:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            raise AssertionError("upstream client should not be created")

    monkeypatch.setattr(proxy.httpx, "AsyncClient", _UnexpectedAsyncClient)

    response = await proxy.proxy_http_to_anyharness(
        request,
        upstream_base_url="https://sandbox.example.test",
        upstream_token="sandbox-token",
        path="v1/sessions",
    )

    assert response.status_code == 499


def test_websocket_upstream_url_rewrites_access_token_and_preserves_after_seq() -> None:
    class _FakeWebSocket:
        scope = {
            "raw_path": b"/v1/gateway/cloud-sandbox/anyharness/v1/terminals/term%2F1/ws",
        }
        query_params = QueryParams("access_token=product-token&after_seq=42&tail=true")

    upstream = proxy._websocket_upstream_url(
        cast(WebSocket, _FakeWebSocket()),
        upstream_base_url="https://sandbox.example.test",
        upstream_token="sandbox-token",
        path="v1/terminals/term/1/ws",
    )

    assert upstream == (
        "wss://sandbox.example.test/v1/terminals/term%2F1/ws"
        "?after_seq=42&tail=true&access_token=sandbox-token"
    )
