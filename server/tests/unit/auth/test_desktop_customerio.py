from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import Request
from fastapi_users.router.oauth import CSRF_TOKEN_KEY

from proliferate.auth.desktop import service as desktop_service
from proliferate.config import settings
from proliferate.db.models.auth import User


def _make_request() -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "https",
            "path": "/auth/desktop/github/callback",
            "raw_path": b"/auth/desktop/github/callback",
            "query_string": b"",
            "headers": [],
            "client": ("testclient", 50000),
            "server": ("testserver", 443),
        }
    )


def _make_state_payload() -> dict[str, str]:
    return {
        CSRF_TOKEN_KEY: "csrf-token",
        "desktop_state": "desktop-github-state",
        "code_challenge": "challenge",
        "code_challenge_method": "S256",
        "redirect_uri": "proliferate://auth/callback",
    }


def _make_user(email: str, *, display_name: str | None) -> User:
    return User(
        id=uuid.uuid4(),
        email=email,
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name=display_name,
    )


def _stub_decode_state(*args: object, **kwargs: object) -> dict[str, str]:
    del args, kwargs
    return _make_state_payload()


@pytest.mark.asyncio
async def test_finish_github_desktop_callback_syncs_customerio_for_new_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = _make_request()
    user = _make_user("desktop-github@example.com", display_name=None)
    user_manager = SimpleNamespace(oauth_callback=AsyncMock(return_value=user))
    create_auth_code_mock = AsyncMock(return_value=SimpleNamespace(code="auth-code"))
    schedule_mock = Mock()

    monkeypatch.setattr(settings, "github_oauth_client_id", "github-client-id")
    monkeypatch.setattr(settings, "github_oauth_client_secret", "github-client-secret")
    monkeypatch.setattr(settings, "api_base_url", "https://api.proliferate.com")
    monkeypatch.setattr(desktop_service, "decode_jwt", _stub_decode_state)
    monkeypatch.setattr(
        desktop_service.github_oauth_client,
        "get_access_token",
        AsyncMock(return_value={"access_token": "github-access-token"}),
    )
    monkeypatch.setattr(
        desktop_service.github_oauth_client,
        "get_id_email",
        AsyncMock(return_value=("github-account-desktop", "desktop-github@example.com")),
    )
    monkeypatch.setattr(desktop_service, "create_auth_code_for_user", create_auth_code_mock)
    monkeypatch.setattr(
        desktop_service,
        "schedule_customerio_desktop_authenticated_user_sync",
        schedule_mock,
    )

    response = await desktop_service.finish_github_desktop_callback(
        request,
        code="github-code",
        state="oauth-state",
        error=None,
        error_description=None,
        desktop_github_csrf="csrf-token",
        user_manager=user_manager,
    )

    assert response.status_code == 200
    assert "proliferate://auth/callback?code=auth-code" in response.body.decode()
    create_auth_code_mock.assert_awaited_once()
    schedule_mock.assert_called_once_with(user)


@pytest.mark.asyncio
async def test_finish_github_desktop_callback_syncs_customerio_for_existing_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = _make_request()
    user = _make_user("linked@example.com", display_name="Linked User")
    user_manager = SimpleNamespace(oauth_callback=AsyncMock(return_value=user))
    create_auth_code_mock = AsyncMock(return_value=SimpleNamespace(code="auth-code"))
    schedule_mock = Mock()

    monkeypatch.setattr(settings, "github_oauth_client_id", "github-client-id")
    monkeypatch.setattr(settings, "github_oauth_client_secret", "github-client-secret")
    monkeypatch.setattr(settings, "api_base_url", "https://api.proliferate.com")
    monkeypatch.setattr(desktop_service, "decode_jwt", _stub_decode_state)
    monkeypatch.setattr(
        desktop_service.github_oauth_client,
        "get_access_token",
        AsyncMock(return_value={"access_token": "github-access-token"}),
    )
    monkeypatch.setattr(
        desktop_service.github_oauth_client,
        "get_id_email",
        AsyncMock(return_value=("github-account-linked", "linked@example.com")),
    )
    monkeypatch.setattr(desktop_service, "create_auth_code_for_user", create_auth_code_mock)
    monkeypatch.setattr(
        desktop_service,
        "schedule_customerio_desktop_authenticated_user_sync",
        schedule_mock,
    )

    response = await desktop_service.finish_github_desktop_callback(
        request,
        code="github-code",
        state="oauth-state",
        error=None,
        error_description=None,
        desktop_github_csrf="csrf-token",
        user_manager=user_manager,
    )

    assert response.status_code == 200
    schedule_mock.assert_called_once_with(user)


@pytest.mark.asyncio
async def test_finish_github_desktop_callback_skips_customerio_when_oauth_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = _make_request()
    user_manager = SimpleNamespace(oauth_callback=AsyncMock())
    schedule_mock = Mock()

    monkeypatch.setattr(settings, "github_oauth_client_id", "github-client-id")
    monkeypatch.setattr(settings, "github_oauth_client_secret", "github-client-secret")
    monkeypatch.setattr(settings, "api_base_url", "https://api.proliferate.com")
    monkeypatch.setattr(desktop_service, "decode_jwt", _stub_decode_state)
    monkeypatch.setattr(
        desktop_service.github_oauth_client,
        "get_access_token",
        AsyncMock(side_effect=RuntimeError("github down")),
    )
    monkeypatch.setattr(
        desktop_service,
        "schedule_customerio_desktop_authenticated_user_sync",
        schedule_mock,
    )

    response = await desktop_service.finish_github_desktop_callback(
        request,
        code="github-code",
        state="oauth-state",
        error=None,
        error_description=None,
        desktop_github_csrf="csrf-token",
        user_manager=user_manager,
    )

    assert response.status_code == 200
    assert "GitHub did not return a usable account" in response.body.decode()
    schedule_mock.assert_not_called()


@pytest.mark.asyncio
async def test_finish_github_desktop_callback_skips_customerio_when_auth_code_creation_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = _make_request()
    user = _make_user("desktop-github@example.com", display_name=None)
    user_manager = SimpleNamespace(oauth_callback=AsyncMock(return_value=user))
    schedule_mock = Mock()

    monkeypatch.setattr(settings, "github_oauth_client_id", "github-client-id")
    monkeypatch.setattr(settings, "github_oauth_client_secret", "github-client-secret")
    monkeypatch.setattr(settings, "api_base_url", "https://api.proliferate.com")
    monkeypatch.setattr(desktop_service, "decode_jwt", _stub_decode_state)
    monkeypatch.setattr(
        desktop_service.github_oauth_client,
        "get_access_token",
        AsyncMock(return_value={"access_token": "github-access-token"}),
    )
    monkeypatch.setattr(
        desktop_service.github_oauth_client,
        "get_id_email",
        AsyncMock(return_value=("github-account-desktop", "desktop-github@example.com")),
    )
    monkeypatch.setattr(
        desktop_service,
        "create_auth_code_for_user",
        AsyncMock(side_effect=RuntimeError("auth code write failed")),
    )
    monkeypatch.setattr(
        desktop_service,
        "schedule_customerio_desktop_authenticated_user_sync",
        schedule_mock,
    )

    with pytest.raises(RuntimeError, match="auth code write failed"):
        await desktop_service.finish_github_desktop_callback(
            request,
            code="github-code",
            state="oauth-state",
            error=None,
            error_description=None,
            desktop_github_csrf="csrf-token",
            user_manager=user_manager,
        )

    schedule_mock.assert_not_called()


@pytest.mark.asyncio
async def test_sync_customerio_desktop_authenticated_user_calls_identify_then_track(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = _make_user("desktop-github@example.com", display_name="Display Name")
    identify_mock = AsyncMock()
    track_mock = AsyncMock()
    monkeypatch.setattr(desktop_service, "identify_customerio_user", identify_mock)
    monkeypatch.setattr(
        desktop_service,
        "track_customerio_desktop_authenticated",
        track_mock,
    )

    await desktop_service.sync_customerio_desktop_authenticated_user(user)

    identify_mock.assert_awaited_once_with(
        user_id=str(user.id),
        email="desktop-github@example.com",
        display_name="Display Name",
    )
    track_mock.assert_awaited_once_with(user_id=str(user.id))
