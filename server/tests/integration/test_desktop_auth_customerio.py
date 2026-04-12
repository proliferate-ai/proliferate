"""Integration coverage for Customer.io sync in the desktop GitHub auth flow."""

from __future__ import annotations

import base64
import hashlib
from unittest.mock import AsyncMock, Mock
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import AsyncClient

from proliferate.auth.desktop import service as desktop_service
from proliferate.auth.oauth import github_oauth_client
from proliferate.config import settings


def _make_pkce_pair() -> tuple[str, str]:
    verifier = "customerio-test-code-verifier-that-is-long-enough-for-pkce"
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


async def _create_user(email: str, *, display_name: str | None = None) -> str:
    from proliferate.db import engine as engine_module
    from proliferate.db.models.auth import User

    async with engine_module.async_session_factory() as session:
        user = User(
            email=email,
            hashed_password="unused-oauth-only",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name=display_name,
        )
        session.add(user)
        await session.commit()
        return str(user.id)


def _enable_github(monkeypatch: pytest.MonkeyPatch, email: str) -> None:
    monkeypatch.setattr(settings, "github_oauth_client_id", "github-client-id")
    monkeypatch.setattr(settings, "github_oauth_client_secret", "github-client-secret")

    async def fake_get_authorization_url(
        redirect_uri: str,
        state: str | None = None,
        scope: list[str] | None = None,
        code_challenge: str | None = None,
        code_challenge_method: str | None = None,
        extras_params: dict[str, str] | None = None,
    ) -> str:
        assert redirect_uri.endswith("/auth/desktop/github/callback")
        assert scope == ["repo", "user", "user:email"]
        assert code_challenge is None
        assert code_challenge_method is None
        assert state is not None
        url = f"https://github.com/login/oauth/authorize?state={state}&redirect_uri={redirect_uri}"
        if extras_params:
            url += "".join(f"&{key}={value}" for key, value in extras_params.items())
        return url

    async def fake_get_access_token(code: str, redirect_uri: str) -> dict[str, object]:
        assert code == "github-code"
        assert redirect_uri.endswith("/auth/desktop/github/callback")
        return {"access_token": "github-access-token", "expires_at": 3600}

    async def fake_get_id_email(token: str) -> tuple[str, str]:
        assert token == "github-access-token"
        return (f"github-account-{email}", email)

    monkeypatch.setattr(
        github_oauth_client,
        "get_authorization_url",
        fake_get_authorization_url,
    )
    monkeypatch.setattr(
        github_oauth_client,
        "get_access_token",
        fake_get_access_token,
    )
    monkeypatch.setattr(
        github_oauth_client,
        "get_id_email",
        fake_get_id_email,
    )


async def _start_browser_flow(client: AsyncClient) -> tuple[str, str]:
    verifier, challenge = _make_pkce_pair()
    authorize = await client.get(
        "/auth/desktop/github/authorize",
        params={
            "state": "desktop-github-state",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "redirect_uri": "proliferate://auth/callback",
        },
        follow_redirects=False,
    )
    assert authorize.status_code == 302
    oauth_state = parse_qs(urlparse(authorize.headers["location"]).query)["state"][0]
    return verifier, oauth_state


class TestDesktopGitHubCustomerIoSync:
    @pytest.mark.asyncio
    async def test_syncs_customerio_for_new_github_user(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        schedule_mock = Mock()
        monkeypatch.setattr(
            desktop_service,
            "schedule_customerio_desktop_authenticated_user_sync",
            schedule_mock,
        )
        _enable_github(monkeypatch, "desktop-github@example.com")
        verifier, oauth_state = await _start_browser_flow(client)

        callback = await client.get(
            "/auth/desktop/github/callback",
            params={"code": "github-code", "state": oauth_state},
        )

        assert callback.status_code == 200
        assert "Opening Proliferate..." in callback.text
        schedule_mock.assert_called_once()
        scheduled_user = schedule_mock.call_args.args[0]
        assert scheduled_user.email == "desktop-github@example.com"
        assert scheduled_user.display_name is None

        exchange = await client.post(
            "/auth/desktop/poll",
            json={
                "state": "desktop-github-state",
                "code_verifier": verifier,
            },
        )
        assert exchange.status_code == 200
        assert exchange.json()["user"]["email"] == "desktop-github@example.com"

    @pytest.mark.asyncio
    async def test_syncs_customerio_for_existing_github_user(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        user_id = await _create_user("linked@example.com", display_name="Linked User")
        schedule_mock = Mock()
        monkeypatch.setattr(
            desktop_service,
            "schedule_customerio_desktop_authenticated_user_sync",
            schedule_mock,
        )
        _enable_github(monkeypatch, "linked@example.com")
        verifier, oauth_state = await _start_browser_flow(client)

        callback = await client.get(
            "/auth/desktop/github/callback",
            params={"code": "github-code", "state": oauth_state},
        )

        assert callback.status_code == 200
        schedule_mock.assert_called_once()
        scheduled_user = schedule_mock.call_args.args[0]
        assert str(scheduled_user.id) == user_id
        assert scheduled_user.email == "linked@example.com"
        assert scheduled_user.display_name == "Linked User"

        exchange = await client.post(
            "/auth/desktop/poll",
            json={
                "state": "desktop-github-state",
                "code_verifier": verifier,
            },
        )
        assert exchange.status_code == 200
        assert exchange.json()["user"]["email"] == "linked@example.com"

    @pytest.mark.asyncio
    async def test_does_not_sync_customerio_when_github_exchange_fails(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        schedule_mock = Mock()
        monkeypatch.setattr(
            desktop_service,
            "schedule_customerio_desktop_authenticated_user_sync",
            schedule_mock,
        )
        _enable_github(monkeypatch, "desktop-github@example.com")
        verifier, oauth_state = await _start_browser_flow(client)

        async def broken_get_access_token(_code: str, _redirect_uri: str) -> dict[str, object]:
            raise RuntimeError("github down")

        monkeypatch.setattr(
            github_oauth_client,
            "get_access_token",
            broken_get_access_token,
        )

        callback = await client.get(
            "/auth/desktop/github/callback",
            params={"code": "github-code", "state": oauth_state},
        )

        assert callback.status_code == 200
        assert "GitHub did not return a usable account" in callback.text
        schedule_mock.assert_not_called()

        pending = await client.post(
            "/auth/desktop/poll",
            json={
                "state": "desktop-github-state",
                "code_verifier": verifier,
            },
        )
        assert pending.status_code == 202

    @pytest.mark.asyncio
    async def test_does_not_sync_customerio_when_auth_code_creation_fails(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        schedule_mock = Mock()
        create_auth_code_mock = AsyncMock(side_effect=RuntimeError("auth code write failed"))
        monkeypatch.setattr(
            desktop_service,
            "schedule_customerio_desktop_authenticated_user_sync",
            schedule_mock,
        )
        monkeypatch.setattr(
            desktop_service,
            "create_auth_code_for_user",
            create_auth_code_mock,
        )
        _enable_github(monkeypatch, "desktop-github@example.com")
        _, oauth_state = await _start_browser_flow(client)

        with pytest.raises(RuntimeError, match="auth code write failed"):
            await client.get(
                "/auth/desktop/github/callback",
                params={"code": "github-code", "state": oauth_state},
            )

        schedule_mock.assert_not_called()
