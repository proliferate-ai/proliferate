"""Async HTTP/SSE and WebSocket proxy helpers for the managed sandbox gateway."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from contextlib import suppress
from urllib.parse import parse_qsl, urlencode

import httpx
import websockets
from fastapi import Request, WebSocket
from starlette.background import BackgroundTask
from starlette.requests import ClientDisconnect
from starlette.responses import Response, StreamingResponse
from starlette.websockets import WebSocketDisconnect
from websockets.exceptions import ConnectionClosed

from proliferate.server.cloud.errors import CloudApiError

_ANYHARNESS_MARKER = "/managed-sandbox/anyharness"
_HTTP_TIMEOUT = httpx.Timeout(connect=10.0, read=None, write=30.0, pool=10.0)
_STRIP_REQUEST_HEADERS = {
    "authorization",
    "cookie",
    "host",
    "connection",
    "keep-alive",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "sec-websocket-protocol",
}
_STRIP_RESPONSE_HEADERS = {
    "connection",
    "keep-alive",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


def _should_strip_header(name: str, *, response: bool = False) -> bool:
    lowered = name.lower()
    if lowered.startswith("proxy-"):
        return True
    return lowered in (_STRIP_RESPONSE_HEADERS if response else _STRIP_REQUEST_HEADERS)


def _raw_anyharness_path(scope: Mapping[str, object], fallback_path: str) -> str:
    raw_path = scope.get("raw_path")
    if isinstance(raw_path, bytes):
        path = raw_path.decode("latin-1")
    else:
        scoped_path = scope.get("path")
        path = scoped_path if isinstance(scoped_path, str) else fallback_path

    marker_index = path.find(_ANYHARNESS_MARKER)
    if marker_index < 0:
        return fallback_path.lstrip("/")

    remainder = path[marker_index + len(_ANYHARNESS_MARKER) :]
    return remainder[1:] if remainder.startswith("/") else remainder


_STRIP_QUERY_PARAMS = {"access_token"}


def _query_string(scope: Mapping[str, object]) -> str:
    raw_query = scope.get("query_string")
    if not isinstance(raw_query, bytes):
        return ""
    query_items = [
        (name, value)
        for name, value in parse_qsl(
            raw_query.decode("latin-1"),
            keep_blank_values=True,
        )
        if name not in _STRIP_QUERY_PARAMS
    ]
    return urlencode(query_items, doseq=True)


def _upstream_url(base_url: str, raw_path: str, query_string: str) -> str:
    upstream = f"{base_url.rstrip('/')}/{raw_path.lstrip('/')}"
    if query_string:
        upstream = f"{upstream}?{query_string}"
    return upstream


def _request_headers(headers: Mapping[str, str], *, upstream_token: str) -> dict[str, str]:
    forwarded = {name: value for name, value in headers.items() if not _should_strip_header(name)}
    forwarded["authorization"] = f"Bearer {upstream_token}"
    return forwarded


def _websocket_headers(headers: Mapping[str, str]) -> dict[str, str]:
    return {name: value for name, value in headers.items() if not _should_strip_header(name)}


def _response_headers(headers: Mapping[str, str]) -> dict[str, str]:
    return {
        name: value
        for name, value in headers.items()
        if not _should_strip_header(name, response=True)
    }


async def _close_http_upstream(
    response: httpx.Response,
    client: httpx.AsyncClient,
) -> None:
    await response.aclose()
    await client.aclose()


async def proxy_http_to_anyharness(
    request: Request,
    *,
    upstream_base_url: str,
    upstream_token: str,
    path: str,
) -> Response:
    raw_path = _raw_anyharness_path(request.scope, path)
    upstream = _upstream_url(upstream_base_url, raw_path, _query_string(request.scope))
    try:
        body = await request.body()
    except ClientDisconnect:
        return Response(status_code=499)

    client = httpx.AsyncClient(timeout=_HTTP_TIMEOUT, follow_redirects=False)
    upstream_request = client.build_request(
        request.method,
        upstream,
        headers=_request_headers(request.headers, upstream_token=upstream_token),
        content=body,
    )
    try:
        upstream_response = await client.send(upstream_request, stream=True)
    except httpx.RequestError as exc:
        await client.aclose()
        raise CloudApiError(
            "managed_sandbox_gateway_unreachable",
            "Managed sandbox runtime could not be reached.",
            status_code=502,
        ) from exc

    return StreamingResponse(
        upstream_response.aiter_raw(),
        status_code=upstream_response.status_code,
        headers=_response_headers(upstream_response.headers),
        background=BackgroundTask(_close_http_upstream, upstream_response, client),
    )


def _websocket_upstream_url(
    websocket: WebSocket,
    *,
    upstream_base_url: str,
    upstream_token: str,
    path: str,
) -> str:
    raw_path = _raw_anyharness_path(websocket.scope, path)
    query_items = [
        (name, value)
        for name, value in websocket.query_params.multi_items()
        if name != "access_token"
    ]
    query_items.append(("access_token", upstream_token))
    upstream = _upstream_url(upstream_base_url, raw_path, urlencode(query_items))
    if upstream.startswith("https://"):
        return "wss://" + upstream[len("https://") :]
    if upstream.startswith("http://"):
        return "ws://" + upstream[len("http://") :]
    return upstream


async def _pump_client_to_upstream(
    websocket: WebSocket,
    upstream: object,
) -> None:
    while True:
        try:
            message = await websocket.receive()
        except WebSocketDisconnect:
            await upstream.close()  # type: ignore[attr-defined]
            return
        message_type = message.get("type")
        if message_type == "websocket.disconnect":
            await upstream.close(code=message.get("code") or 1000)  # type: ignore[attr-defined]
            return
        if "text" in message:
            await upstream.send(message["text"])  # type: ignore[attr-defined]
        elif "bytes" in message:
            await upstream.send(message["bytes"])  # type: ignore[attr-defined]


async def _pump_upstream_to_client(
    websocket: WebSocket,
    upstream: object,
) -> None:
    try:
        async for message in upstream:  # type: ignore[attr-defined]
            if isinstance(message, bytes):
                await websocket.send_bytes(message)
            else:
                await websocket.send_text(message)
    except ConnectionClosed as exc:
        close_code = exc.rcvd.code if exc.rcvd is not None else 1000
        with suppress(RuntimeError):
            await websocket.close(code=close_code)


async def proxy_websocket_to_anyharness(
    websocket: WebSocket,
    *,
    upstream_base_url: str,
    upstream_token: str,
    path: str,
    accept_subprotocol: str | None = None,
) -> None:
    upstream_url = _websocket_upstream_url(
        websocket,
        upstream_base_url=upstream_base_url,
        upstream_token=upstream_token,
        path=path,
    )
    headers = _websocket_headers(websocket.headers)
    try:
        async with websockets.connect(
            upstream_url,
            additional_headers=headers,
            proxy=None,
            open_timeout=10,
            ping_interval=20,
            ping_timeout=20,
        ) as upstream:
            await websocket.accept(subprotocol=accept_subprotocol)
            client_task = asyncio.create_task(_pump_client_to_upstream(websocket, upstream))
            upstream_task = asyncio.create_task(_pump_upstream_to_client(websocket, upstream))
            done, pending = await asyncio.wait(
                {client_task, upstream_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*done, *pending, return_exceptions=True)
    except Exception as exc:
        if isinstance(exc, ConnectionClosed):
            return
        with suppress(RuntimeError):
            await websocket.close(code=1011)
        return
