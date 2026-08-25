"""Event-order characterizations for product account entry."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import Request
from fastapi_users.router.oauth import CSRF_TOKEN_KEY

from proliferate.auth.identity.models import PasswordLoginRequest
from proliferate.auth.identity.types import AuthChallengeSnapshot, VerifiedProviderIdentity
from proliferate.auth.users import OAuthCallbackResult
from proliferate.config import settings
from proliferate.db.models.auth import User
from proliferate.server.accounts.desktop import api as desktop_api
from proliferate.server.accounts.desktop import service as desktop_service
from proliferate.server.accounts.identity import service as identity_service


def _user() -> User:
    return User(
        id=uuid.uuid4(),
        email="person@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name="Person",
    )


def _request() -> Request:
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


@pytest.mark.asyncio
async def test_desktop_new_user_places_before_profile_identity_admin_and_effects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    user = _user()
    manager = SimpleNamespace(
        oauth_callback_with_result=AsyncMock(
            return_value=OAuthCallbackResult(user=user, created=True)
        )
    )

    async def place(*_args: object, **_kwargs: object) -> None:
        events.append("placement")

    async def profile(*_args: object, **_kwargs: object) -> User:
        events.append("profile")
        return user

    async def attach(*_args: object, **_kwargs: object) -> None:
        events.append("identity")

    async def admin(*_args: object, **_kwargs: object) -> None:
        events.append("admin")

    async def auth_code(*_args: object, **_kwargs: object) -> SimpleNamespace:
        events.append("auth_code")
        return SimpleNamespace(code="code")

    monkeypatch.setattr(settings, "github_oauth_client_id", "client")
    monkeypatch.setattr(settings, "github_oauth_client_secret", "secret")
    monkeypatch.setattr(settings, "api_base_url", "https://api.example.test")
    monkeypatch.setattr(
        desktop_service,
        "decode_jwt",
        lambda *_args, **_kwargs: {
            CSRF_TOKEN_KEY: "csrf",
            "desktop_state": "state",
            "code_challenge": "challenge",
            "code_challenge_method": "S256",
            "redirect_uri": "proliferate://auth/callback",
        },
    )
    monkeypatch.setattr(
        desktop_service.github_oauth_client,
        "get_access_token",
        AsyncMock(return_value={"access_token": "token"}),
    )
    monkeypatch.setattr(
        desktop_service.github_oauth_client,
        "get_id_email",
        AsyncMock(return_value=("github-id", user.email)),
    )
    monkeypatch.setattr(
        desktop_service,
        "github_oauth_account_or_email_exists",
        AsyncMock(return_value=False),
    )
    monkeypatch.setattr(
        desktop_service,
        "get_github_user_profile",
        AsyncMock(
            return_value=SimpleNamespace(login="person", avatar_url=None, display_name="Person")
        ),
    )
    monkeypatch.setattr(desktop_service, "place_new_identity", place)
    monkeypatch.setattr(desktop_service, "update_user_github_profile", profile)
    monkeypatch.setattr(desktop_service, "attach_verified_identity", attach)
    monkeypatch.setattr(desktop_service, "ensure_admin_email_role", admin)
    monkeypatch.setattr(desktop_service, "create_auth_code", auth_code)
    monkeypatch.setattr(
        desktop_service,
        "schedule_agent_gateway_user_enrollment",
        lambda *_args, **_kwargs: events.append("agent_gateway"),
    )
    monkeypatch.setattr(
        desktop_service,
        "schedule_signup_slack_notification",
        lambda *_args, **_kwargs: events.append("signup_notification"),
    )

    await desktop_service.finish_github_desktop_callback(
        object(),  # type: ignore[arg-type]
        _request(),
        code="code",
        state="state",
        error=None,
        error_description=None,
        desktop_github_csrf="csrf",
        user_manager=manager,
    )

    assert events == [
        "placement",
        "profile",
        "identity",
        "admin",
        "auth_code",
        "agent_gateway",
        "signup_notification",
    ]


@pytest.mark.asyncio
async def test_provider_new_user_places_before_identity_attachment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    user = _user()
    challenge = AuthChallengeSnapshot(
        id=uuid.uuid4(),
        provider="google",
        surface="web",
        purpose="login",
        user_id=None,
        client_state="state",
        code_challenge="challenge",
        code_challenge_method="S256",
        redirect_uri="https://app.example.test/callback",
        nonce_hash="nonce",
    )
    verified = VerifiedProviderIdentity(
        provider="google",
        provider_subject="google-id",
        email=user.email,
        email_verified=True,
        display_name=None,
        provider_login=None,
        avatar_url=None,
        access_token="token",
        refresh_token=None,
        expires_at=None,
        expires_at_timestamp=None,
        scopes=frozenset(),
    )
    monkeypatch.setattr(
        identity_service,
        "get_identity_by_provider_subject",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(identity_service, "get_user_by_email", AsyncMock(return_value=None))
    monkeypatch.setattr(identity_service, "create_auth_user", AsyncMock(return_value=user))
    monkeypatch.setattr(
        identity_service,
        "place_new_identity",
        AsyncMock(side_effect=lambda *_args, **_kwargs: events.append("placement")),
    )
    monkeypatch.setattr(
        identity_service,
        "attach_verified_identity",
        AsyncMock(side_effect=lambda *_args, **_kwargs: events.append("identity")),
    )
    monkeypatch.setattr(
        identity_service,
        "ensure_admin_email_role",
        AsyncMock(side_effect=lambda *_args, **_kwargs: events.append("admin")),
    )

    await identity_service.resolve_provider_user(object(), verified=verified, challenge=challenge)  # type: ignore[arg-type]

    assert events == ["placement", "identity", "admin"]


@pytest.mark.asyncio
async def test_password_admin_floor_follows_verification_and_precedes_session_and_desktop_mint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    user = _user()

    async def verified(*_args: object, **_kwargs: object) -> User:
        events.append("verification")
        return user

    async def admin(*_args: object, **_kwargs: object) -> None:
        events.append("admin")

    async def session(*_args: object, **_kwargs: object) -> SimpleNamespace:
        events.append("session")
        return SimpleNamespace()

    monkeypatch.setattr(identity_service, "verify_password_user", verified)
    monkeypatch.setattr(identity_service, "ensure_admin_email_role", admin)
    monkeypatch.setattr(identity_service, "mint_auth_session", session)

    await identity_service.authenticate_password_login(
        object(), email=user.email, password="password", client_ip=None
    )
    assert events == ["verification", "admin", "session"]

    events.clear()
    monkeypatch.setattr(desktop_api, "mint_desktop_tokens", session)
    db = SimpleNamespace(commit=AsyncMock(side_effect=lambda: events.append("commit")))
    await desktop_api.desktop_password_login(
        PasswordLoginRequest(email=user.email, password="password"),
        _request(),
        db,
    )
    assert events == ["verification", "admin", "commit", "session"]
