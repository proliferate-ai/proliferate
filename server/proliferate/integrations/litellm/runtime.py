"""Runtime forwarding client for the private LiteLLM proxy."""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass

import httpx

from proliferate.config import settings
from proliferate.integrations.litellm.errors import LiteLLMIntegrationError

_HOP_BY_HOP_HEADERS = {
    "connection",
    "content-encoding",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


@dataclass(frozen=True)
class LiteLLMRuntimeResponse:
    status_code: int
    headers: dict[str, str]
    content: bytes


@dataclass(frozen=True)
class LiteLLMRuntimeStream:
    status_code: int
    headers: dict[str, str]
    chunks: AsyncIterator[bytes]


class LiteLLMRuntimeStatusError(LiteLLMIntegrationError):
    """Raised when LiteLLM returns an error response for a gateway request."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int,
        body: bytes,
    ) -> None:
        super().__init__(message, status_code=status_code)
        self.body = body


class LiteLLMRuntimeClient:
    """Thin runtime proxy for model calls after gateway authorization."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        self._base_url = (base_url or settings.agent_gateway_litellm_base_url).rstrip("/")
        self._timeout_seconds = (
            timeout_seconds
            if timeout_seconds is not None
            else settings.agent_gateway_request_timeout_seconds
        )

    async def forward(
        self,
        *,
        method: str,
        path: str,
        body: bytes,
        litellm_key: str,
        content_type: str | None,
        metadata: Mapping[str, str],
    ) -> LiteLLMRuntimeResponse:
        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            try:
                response = await client.request(
                    method,
                    f"{self._base_url}{path}",
                    content=body,
                    headers=_headers(litellm_key, content_type, metadata),
                )
            except httpx.HTTPError as exc:
                raise LiteLLMIntegrationError("Could not reach LiteLLM proxy.") from exc
        if response.status_code < 200 or response.status_code >= 300:
            raise LiteLLMRuntimeStatusError(
                f"LiteLLM runtime request failed with HTTP {response.status_code}.",
                status_code=response.status_code,
                body=response.content,
            )
        return LiteLLMRuntimeResponse(
            status_code=response.status_code,
            headers=_response_headers(response.headers),
            content=response.content,
        )

    async def open_stream(
        self,
        *,
        method: str,
        path: str,
        body: bytes,
        litellm_key: str,
        content_type: str | None,
        metadata: Mapping[str, str],
    ) -> LiteLLMRuntimeStream:
        client = httpx.AsyncClient(timeout=None)
        request = client.build_request(
            method,
            f"{self._base_url}{path}",
            content=body,
            headers=_headers(litellm_key, content_type, metadata),
        )
        try:
            response = await client.send(request, stream=True)
        except httpx.HTTPError as exc:
            await client.aclose()
            raise LiteLLMIntegrationError("Could not reach LiteLLM proxy.") from exc
        if response.status_code < 200 or response.status_code >= 300:
            body_bytes = await response.aread()
            await response.aclose()
            await client.aclose()
            raise LiteLLMRuntimeStatusError(
                f"LiteLLM runtime request failed with HTTP {response.status_code}.",
                status_code=response.status_code,
                body=body_bytes,
            )

        async def chunks() -> AsyncIterator[bytes]:
            try:
                async for chunk in response.aiter_bytes():
                    yield chunk
            finally:
                await response.aclose()
                await client.aclose()

        return LiteLLMRuntimeStream(
            status_code=response.status_code,
            headers=_response_headers(response.headers),
            chunks=chunks(),
        )


def _headers(
    litellm_key: str,
    content_type: str | None,
    metadata: Mapping[str, str],
) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {litellm_key}",
    }
    if content_type:
        headers["Content-Type"] = content_type
    for key, value in metadata.items():
        headers[f"x-proliferate-{key.replace('_', '-')}"] = value
    return headers


def _response_headers(headers: Mapping[str, str]) -> dict[str, str]:
    return {
        key: value
        for key, value in headers.items()
        if key.lower() not in _HOP_BY_HOP_HEADERS
    }
