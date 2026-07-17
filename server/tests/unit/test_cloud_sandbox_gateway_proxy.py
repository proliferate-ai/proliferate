from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from importlib.metadata import version as package_version
from typing import cast

import httpx
import pytest
from fastapi import Request, WebSocket
from starlette.datastructures import QueryParams
from starlette.requests import ClientDisconnect
from starlette.responses import StreamingResponse
from starlette.types import Message, Scope

from proliferate.server.cloud.gateway import proxy


def _request(body: bytes = b"payload", *, method: str = "POST") -> Request:
    async def receive() -> dict[str, object]:
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(
        {
            "type": "http",
            "method": method,
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


async def _response_body(
    response: StreamingResponse,
    *,
    disconnect_after_first_chunk: bool = False,
) -> bytes:
    body = bytearray()

    async def receive() -> Message:
        return {"type": "http.disconnect"}

    async def send(message: Message) -> None:
        if message["type"] != "http.response.body":
            return
        chunk = message.get("body", b"")
        if disconnect_after_first_chunk and chunk:
            raise OSError("downstream disconnected")
        body.extend(chunk)

    scope = cast(Scope, {"type": "http", "asgi": {"spec_version": "2.4"}})
    await response(scope, receive, send)
    return bytes(body)


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

    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)

    response = cast(
        StreamingResponse,
        await proxy.proxy_http_to_anyharness(
            _request(),
            upstream_base_url="https://sandbox.example.test",
            upstream_token="sandbox-token",
            path="v1/sessions/ws/encoded",
        ),
    )
    body = await _response_body(response)

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
    assert response.background is None
    assert client.closed is True


@pytest.mark.asyncio
async def test_incomplete_chunk_message_matches_pinned_http_stack() -> None:
    # Keep dependency upgrades coupled to re-verifying the exact parser message
    # that the SSE-only production guard recognizes.
    assert (
        package_version("httpx"),
        package_version("httpcore"),
        package_version("h11"),
    ) == ("0.28.1", "1.0.9", "0.16.0")

    async def close_incomplete_chunk(
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        try:
            await reader.readuntil(b"\r\n\r\n")
            writer.write(
                b"HTTP/1.1 200 OK\r\n"
                b"Content-Type: text/event-stream\r\n"
                b"Transfer-Encoding: chunked\r\n"
                b"Connection: close\r\n\r\n"
                b"20\r\n"
                b"event: one\ndata: {}\n\n"
            )
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(close_incomplete_chunk, "127.0.0.1", 0)
    try:
        sockets = server.sockets
        assert sockets
        _host, port = cast(tuple[str, int], sockets[0].getsockname())

        async with (
            httpx.AsyncClient(trust_env=False) as client,
            client.stream("GET", f"http://127.0.0.1:{port}/") as response,
        ):
            assert response.headers["content-type"] == "text/event-stream"
            with pytest.raises(httpx.RemoteProtocolError) as caught:
                async for _chunk in response.aiter_raw():
                    pass
    finally:
        server.close()
        await server.wait_closed()

    assert str(caught.value) == proxy._INCOMPLETE_CHUNKED_READ


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("content_type", "error_message", "expect_error"),
    [
        (
            "text/event-stream; charset=utf-8",
            "peer closed connection without sending complete message body "
            "(incomplete chunked read)",
            False,
        ),
        ("text/event-stream", "malformed chunked encoding", True),
        (
            "application/json",
            "peer closed connection without sending complete message body "
            "(incomplete chunked read)",
            True,
        ),
    ],
)
async def test_http_proxy_handles_incomplete_chunk_close_only_for_sse(
    monkeypatch: pytest.MonkeyPatch,
    content_type: str,
    error_message: str,
    expect_error: bool,
) -> None:
    client_closed = False

    class _InterruptedStream(httpx.AsyncByteStream):
        async def __aiter__(self) -> AsyncIterator[bytes]:
            yield b"event: one\ndata: {}\n\n"
            raise httpx.RemoteProtocolError(error_message)

    class _FakeAsyncClient:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        def build_request(
            self,
            method: str,
            url: str,
            *,
            headers: dict[str, str],
            content: bytes,
        ) -> httpx.Request:
            return httpx.Request(method, url, headers=headers, content=content)

        async def send(
            self,
            request: httpx.Request,
            *,
            stream: bool,
        ) -> httpx.Response:
            assert stream is True
            return httpx.Response(
                200,
                headers={"content-type": content_type},
                stream=_InterruptedStream(),
                request=request,
            )

        async def aclose(self) -> None:
            nonlocal client_closed
            client_closed = True

    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)

    response = cast(
        StreamingResponse,
        await proxy.proxy_http_to_anyharness(
            _request(b"", method="GET"),
            upstream_base_url="https://sandbox.example.test",
            upstream_token="sandbox-token",
            path="v1/sessions/session-id/stream",
        ),
    )

    if expect_error:
        with pytest.raises(httpx.RemoteProtocolError) as caught:
            await _response_body(response)
        assert str(caught.value) == error_message
    else:
        body = await _response_body(response)
        assert body == b"event: one\ndata: {}\n\n"

    assert client_closed is True


@pytest.mark.asyncio
async def test_http_proxy_closes_upstream_when_downstream_disconnects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client_closed = False
    upstream_response: httpx.Response | None = None

    class _TwoChunkStream(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self) -> AsyncIterator[bytes]:
            yield b"event: one\ndata: {}\n\n"
            yield b"event: two\ndata: {}\n\n"

        async def aclose(self) -> None:
            self.closed = True

    upstream_stream = _TwoChunkStream()

    class _FakeAsyncClient:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        def build_request(
            self,
            method: str,
            url: str,
            *,
            headers: dict[str, str],
            content: bytes,
        ) -> httpx.Request:
            return httpx.Request(method, url, headers=headers, content=content)

        async def send(
            self,
            request: httpx.Request,
            *,
            stream: bool,
        ) -> httpx.Response:
            nonlocal upstream_response
            assert stream is True
            upstream_response = httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                stream=upstream_stream,
                request=request,
            )
            return upstream_response

        async def aclose(self) -> None:
            nonlocal client_closed
            client_closed = True

    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)

    response = cast(
        StreamingResponse,
        await proxy.proxy_http_to_anyharness(
            _request(b"", method="GET"),
            upstream_base_url="https://sandbox.example.test",
            upstream_token="sandbox-token",
            path="v1/sessions/session-id/stream",
        ),
    )

    with pytest.raises(ClientDisconnect):
        await _response_body(response, disconnect_after_first_chunk=True)

    assert upstream_response is not None
    assert upstream_response.is_closed is True
    assert upstream_stream.closed is True
    assert client_closed is True


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

    monkeypatch.setattr(httpx, "AsyncClient", _UnexpectedAsyncClient)

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
