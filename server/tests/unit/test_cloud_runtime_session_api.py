from __future__ import annotations

from collections.abc import Callable

import httpx
import pytest

from proliferate.server.cloud.runtime import session_api
from proliferate.server.cloud.runtime.anyharness_api import CloudRuntimeReconnectError
from proliferate.server.cloud.runtime.session_api import (
    CloudRuntimePromptDeliveryUncertainError,
    CloudRuntimeRequestRejectedError,
)


def _client_factory(
    result: httpx.Response | Exception,
) -> Callable[..., object]:
    class _Client:
        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def post(self, *_args: object, **_kwargs: object) -> httpx.Response:
            if isinstance(result, Exception):
                raise result
            return result

    return lambda **_kwargs: _Client()


@pytest.mark.asyncio
async def test_prompt_connect_error_is_definitive_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        session_api.httpx,
        "AsyncClient",
        _client_factory(httpx.ConnectError("connect failed")),
    )

    with pytest.raises(CloudRuntimeReconnectError) as exc_info:
        await session_api.prompt_runtime_session(
            "https://runtime.example",
            "token",
            session_id="session-1",
            prompt="hello",
        )

    assert not isinstance(exc_info.value, CloudRuntimePromptDeliveryUncertainError)


@pytest.mark.asyncio
async def test_prompt_read_timeout_is_delivery_uncertain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        session_api.httpx,
        "AsyncClient",
        _client_factory(httpx.ReadTimeout("read timed out")),
    )

    with pytest.raises(CloudRuntimePromptDeliveryUncertainError):
        await session_api.prompt_runtime_session(
            "https://runtime.example",
            "token",
            session_id="session-1",
            prompt="hello",
        )


@pytest.mark.asyncio
async def test_prompt_5xx_response_is_delivery_uncertain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        session_api.httpx,
        "AsyncClient",
        _client_factory(httpx.Response(502, request=httpx.Request("POST", "https://runtime"))),
    )

    with pytest.raises(CloudRuntimePromptDeliveryUncertainError):
        await session_api.prompt_runtime_session(
            "https://runtime.example",
            "token",
            session_id="session-1",
            prompt="hello",
        )


@pytest.mark.asyncio
async def test_prompt_4xx_response_is_request_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        session_api.httpx,
        "AsyncClient",
        _client_factory(httpx.Response(400, request=httpx.Request("POST", "https://runtime"))),
    )

    with pytest.raises(CloudRuntimeRequestRejectedError):
        await session_api.prompt_runtime_session(
            "https://runtime.example",
            "token",
            session_id="session-1",
            prompt="hello",
        )
