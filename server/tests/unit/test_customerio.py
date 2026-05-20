from __future__ import annotations

from datetime import datetime, UTC
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

    created_at = datetime(2026, 5, 1, 12, 0, 0, tzinfo=UTC)
    await customerio.identify_customerio_user(
        user_id="user-1",
        email="user@example.com",
        display_name="Display Name",
        github_login="octocat",
        github_avatar_url="https://avatars.githubusercontent.com/u/583231?v=4",
        created_at=created_at,
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
        "product_ready": True,
        "github_login": "octocat",
        "github_avatar_url": "https://avatars.githubusercontent.com/u/583231?v=4",
        "created_at": int(created_at.timestamp()),
    }


@pytest.mark.asyncio
async def test_identify_customerio_user_omits_optional_fields_when_missing(
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

    await customerio.identify_customerio_user(
        user_id="user-2",
        email="user2@example.com",
        display_name=None,
    )

    assert len(client.put_calls) == 1
    _url, kwargs = client.put_calls[0]
    assert kwargs["json"] == {
        "email": "user2@example.com",
        "desktop_authenticated": True,
        "desktop_auth_provider": "github",
        "product_ready": True,
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
async def test_customerio_welcome_email_enabled_reports_missing_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "customerio_app_api_key", "")
    monkeypatch.setattr(settings, "customerio_from_email", "hello@proliferate.com")
    monkeypatch.setattr(settings, "customerio_welcome_transactional_message_id", "msg-id")

    assert customerio.customerio_welcome_email_enabled() is False

    monkeypatch.setattr(settings, "customerio_app_api_key", "app-api-key")
    assert customerio.customerio_welcome_email_enabled() is True


@pytest.mark.asyncio
async def test_send_customerio_welcome_email_asserts_when_unconfigured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Callers must gate on customerio_welcome_email_enabled() first; calling
    send_customerio_welcome_email without config is a programming error."""
    monkeypatch.setattr(settings, "customerio_app_api_key", "")
    monkeypatch.setattr(settings, "customerio_from_email", "hello@proliferate.com")
    monkeypatch.setattr(settings, "customerio_welcome_transactional_message_id", "msg-id")

    with pytest.raises(AssertionError):
        await customerio.send_customerio_welcome_email(
            user_id="user-1",
            email="user@example.com",
            display_name="Display Name",
            github_login="octocat",
        )


@pytest.mark.asyncio
async def test_send_customerio_welcome_email_sends_expected_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "customerio_app_api_key", "app-api-key")
    monkeypatch.setattr(settings, "customerio_from_email", "hello@proliferate.com")
    monkeypatch.setattr(
        settings,
        "customerio_welcome_transactional_message_id",
        "welcome-msg-id",
    )
    client = _FakeAsyncClient()
    monkeypatch.setattr(
        customerio.httpx,
        "AsyncClient",
        lambda **_kwargs: client,
    )

    sent = await customerio.send_customerio_welcome_email(
        user_id="user-1",
        email="user@example.com",
        display_name="Display Name",
        github_login="octocat",
    )

    assert sent is True
    assert len(client.post_calls) == 1
    url, kwargs = client.post_calls[0]
    assert url.endswith("/send/email")
    assert kwargs["headers"] == {"Authorization": "Bearer app-api-key"}
    assert kwargs["json"] == {
        "transactional_message_id": "welcome-msg-id",
        "to": "user@example.com",
        "from": "hello@proliferate.com",
        "identifiers": {"id": "user-1"},
        "message_data": {
            "display_name": "Display Name",
            "github_login": "octocat",
        },
    }


@pytest.mark.asyncio
async def test_send_customerio_welcome_email_swallows_http_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "customerio_app_api_key", "app-api-key")
    monkeypatch.setattr(settings, "customerio_from_email", "hello@proliferate.com")
    monkeypatch.setattr(
        settings,
        "customerio_welcome_transactional_message_id",
        "welcome-msg-id",
    )
    client = _FakeAsyncClient(error=RuntimeError("customerio app api down"))
    monkeypatch.setattr(
        customerio.httpx,
        "AsyncClient",
        lambda **_kwargs: client,
    )
    warning_mock = Mock()
    monkeypatch.setattr(customerio.logger, "warning", warning_mock)

    sent = await customerio.send_customerio_welcome_email(
        user_id="user-1",
        email="user@example.com",
        display_name=None,
        github_login=None,
    )

    assert sent is False
    warning_mock.assert_called_once()
    # Static prefix only; no PII / no request object / no auth header.
    assert warning_mock.call_args.args[1] == "Failed to send Customer.io welcome email"


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
    warning_mock = Mock()
    monkeypatch.setattr(customerio.logger, "warning", warning_mock)

    await customerio.identify_customerio_user(
        user_id="user-1",
        email="user@example.com",
        display_name=None,
    )
    await customerio.track_customerio_desktop_authenticated(user_id="user-1")

    assert warning_mock.call_count == 2
    # logger.warning is called with (fmt, message, status, error_type); the
    # static message is the second positional arg.
    assert warning_mock.call_args_list[0].args[1] == "Failed to identify Customer.io user"
    assert (
        warning_mock.call_args_list[1].args[1]
        == "Failed to track Customer.io desktop authentication event"
    )
