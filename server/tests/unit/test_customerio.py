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
        "email_type": "company",
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
        "email_type": "company",
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


def test_derive_email_type_personal_domains() -> None:
    assert customerio.derive_email_type("user@gmail.com") == "personal"
    assert customerio.derive_email_type("user@hotmail.com") == "personal"
    assert customerio.derive_email_type("user@yahoo.com") == "personal"


def test_derive_email_type_company_domains() -> None:
    assert customerio.derive_email_type("user@acme.com") == "company"
    assert customerio.derive_email_type("ceo@stripe.com") == "company"


def test_derive_email_type_missing_or_malformed() -> None:
    assert customerio.derive_email_type(None) == "personal"
    assert customerio.derive_email_type("") == "personal"
    assert customerio.derive_email_type("nodomain") == "personal"


@pytest.mark.asyncio
async def test_push_user_attributes_sends_expected_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "customerio_site_id", "site-id")
    monkeypatch.setattr(settings, "customerio_api_key", "api-key")
    client = _FakeAsyncClient()
    monkeypatch.setattr(customerio.httpx, "AsyncClient", lambda **_kwargs: client)

    ok = await customerio.push_user_attributes(
        user_id="user-1",
        attributes={"workspace_count": 3, "email_type": "company"},
    )

    assert ok is True
    assert len(client.put_calls) == 1
    url, kwargs = client.put_calls[0]
    assert url.endswith("/customers/user-1")
    assert kwargs["auth"] == ("site-id", "api-key")
    assert kwargs["json"] == {"workspace_count": 3, "email_type": "company"}


@pytest.mark.asyncio
async def test_push_user_attributes_noop_without_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "customerio_site_id", "")
    monkeypatch.setattr(settings, "customerio_api_key", "")

    ok = await customerio.push_user_attributes(
        user_id="user-1",
        attributes={"workspace_count": 1},
    )
    assert ok is False


@pytest.mark.asyncio
async def test_push_user_attributes_swallows_http_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "customerio_site_id", "site-id")
    monkeypatch.setattr(settings, "customerio_api_key", "api-key")
    client = _FakeAsyncClient(error=RuntimeError("cio down"))
    monkeypatch.setattr(customerio.httpx, "AsyncClient", lambda **_kwargs: client)
    warning_mock = Mock()
    monkeypatch.setattr(customerio.logger, "warning", warning_mock)

    ok = await customerio.push_user_attributes(
        user_id="user-1",
        attributes={"workspace_count": 0},
    )

    assert ok is False
    warning_mock.assert_called_once()


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
