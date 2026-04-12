from __future__ import annotations

from unittest.mock import Mock

import httpx
import pytest

from proliferate.config import settings
from proliferate.integrations import customerio


class _FakeAsyncClient:
    def __init__(
        self,
        *,
        response: httpx.Response | None = None,
        error: Exception | None = None,
    ) -> None:
        self.response = response or httpx.Response(
            200,
            request=httpx.Request("POST", "https://track.customer.io/api/v1/customers/test"),
        )
        self.error = error
        self.put_calls: list[tuple[str, dict[str, object]]] = []
        self.post_calls: list[tuple[str, dict[str, object]]] = []

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def put(self, url: str, **kwargs: object) -> httpx.Response:
        self.put_calls.append((url, dict(kwargs)))
        if self.error is not None:
            raise self.error
        return self.response

    async def post(self, url: str, **kwargs: object) -> httpx.Response:
        self.post_calls.append((url, dict(kwargs)))
        if self.error is not None:
            raise self.error
        return self.response


@pytest.mark.asyncio
async def test_customerio_helpers_are_noop_without_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "customerio_site_id", "")
    monkeypatch.setattr(settings, "customerio_api_key", "")

    def fail_if_called(**_kwargs: object) -> _FakeAsyncClient:
        raise AssertionError(
            "AsyncClient should not be constructed without Customer.io credentials"
        )

    monkeypatch.setattr(customerio.httpx, "AsyncClient", fail_if_called)
    await customerio.identify_customerio_user(
        user_id="user-1",
        email="user@example.com",
        display_name="Display Name",
    )
    await customerio.track_customerio_desktop_authenticated(user_id="user-1")


@pytest.mark.asyncio
async def test_identify_customerio_user_sends_expected_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "customerio_site_id", "site-id")
    monkeypatch.setattr(settings, "customerio_api_key", "api-key")
    client = _FakeAsyncClient()
    async_client_kwargs: dict[str, object] = {}

    def build_client(**kwargs: object) -> _FakeAsyncClient:
        async_client_kwargs.update(kwargs)
        return client

    monkeypatch.setattr(customerio.httpx, "AsyncClient", build_client)

    await customerio.identify_customerio_user(
        user_id="user-1",
        email="user@example.com",
        display_name="Display Name",
    )

    assert async_client_kwargs["timeout"] == customerio.CUSTOMERIO_TIMEOUT_SECONDS
    assert len(client.put_calls) == 1
    url, kwargs = client.put_calls[0]
    assert url.endswith("/customers/user-1")
    assert kwargs["auth"] == ("site-id", "api-key")
    assert kwargs["json"] == {
        "email": "user@example.com",
        "display_name": "Display Name",
        "desktop_authenticated": True,
        "desktop_auth_provider": "github",
    }


@pytest.mark.asyncio
async def test_track_customerio_desktop_authenticated_sends_expected_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "customerio_site_id", "site-id")
    monkeypatch.setattr(settings, "customerio_api_key", "api-key")
    client = _FakeAsyncClient()

    monkeypatch.setattr(
        customerio.httpx,
        "AsyncClient",
        lambda **_kwargs: client,
    )

    await customerio.track_customerio_desktop_authenticated(user_id="user-1")

    assert len(client.post_calls) == 1
    url, kwargs = client.post_calls[0]
    assert url.endswith("/customers/user-1/events")
    assert kwargs["auth"] == ("site-id", "api-key")
    assert kwargs["json"] == {
        "name": customerio.DESKTOP_AUTHENTICATED_EVENT,
        "data": {"auth_provider": "github"},
    }


@pytest.mark.asyncio
async def test_customerio_helpers_swallow_http_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "customerio_site_id", "site-id")
    monkeypatch.setattr(settings, "customerio_api_key", "api-key")
    client = _FakeAsyncClient(error=RuntimeError("customerio down"))
    monkeypatch.setattr(
        customerio.httpx,
        "AsyncClient",
        lambda **_kwargs: client,
    )
    exception_mock = Mock()
    monkeypatch.setattr(customerio.logger, "exception", exception_mock)

    await customerio.identify_customerio_user(
        user_id="user-1",
        email="user@example.com",
        display_name=None,
    )
    await customerio.track_customerio_desktop_authenticated(user_id="user-1")

    assert exception_mock.call_count == 2
    assert exception_mock.call_args_list[0].args == ("Failed to identify Customer.io user",)
    assert exception_mock.call_args_list[1].args == (
        "Failed to track Customer.io desktop authentication event",
    )
