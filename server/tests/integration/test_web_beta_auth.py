"""Integration tests for beta-gated web auth entry points."""

import base64
import hashlib
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import pytest
from httpx import AsyncClient

from proliferate.auth.desktop.models import AuthorizeParams
from proliferate.auth.desktop import service as desktop_service
from proliferate.auth.identity import providers as identity_providers
from proliferate.auth.identity.web_beta import WEB_BETA_EMAIL_NOT_ALLOWED_CODE
from proliferate.auth.oauth import github_oauth_client
from proliferate.auth.passwords import hash_password
from proliferate.config import settings
from proliferate.db.models.auth import AuthIdentity, User
from proliferate.integrations.github import GitHubUserProfile


def _make_pkce_pair() -> tuple[str, str]:
    verifier = "test-code-verifier-that-is-long-enough-for-pkce"
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


async def _create_user(email: str) -> str:
    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        user = User(
            email=email,
            hashed_password="unused-oauth-only",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name="Beta Tester",
        )
        session.add(user)
        await session.commit()
    return str(user.id)


async def _create_password_user(email: str, password: str) -> str:
    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        user = User(
            email=email,
            hashed_password=hash_password(password),
            password_set_at=datetime.now(UTC),
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name="Beta Password Tester",
        )
        session.add(user)
        await session.commit()
    return str(user.id)


async def _link_github_identity(user_id: str, *, provider_email: str) -> None:
    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        identity = AuthIdentity(
            user_id=UUID(user_id),
            provider="github",
            provider_subject=f"github-account-{provider_email}",
            email=provider_email,
            email_verified=True,
        )
        session.add(identity)
        await session.commit()


async def _create_desktop_auth_code_for_user(
    *,
    user_id: str,
    state: str,
    code_challenge: str,
) -> str:
    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        auth_code = await desktop_service.create_desktop_auth_code(
            session,
            AuthorizeParams(
                state=state,
                code_challenge=code_challenge,
                code_challenge_method="S256",
                redirect_uri="proliferate://auth/callback",
            ),
            UUID(user_id),
        )
        await session.commit()
        return auth_code.code


def _enable_identity_github(monkeypatch: pytest.MonkeyPatch, email: str) -> None:
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
        assert redirect_uri.endswith("/auth/github/callback")
        assert scope == ["repo", "user", "user:email"]
        assert code_challenge is None
        assert code_challenge_method is None
        assert state is not None
        return (
            f"https://github.com/login/oauth/authorize?state={state}&redirect_uri={redirect_uri}"
        )

    async def fake_get_access_token(code: str, redirect_uri: str) -> dict[str, object]:
        assert code == "github-code"
        assert "/auth/" in redirect_uri
        return {"access_token": "github-access-token", "scope": "repo,user"}

    async def fake_get_id_email(token: str) -> tuple[str, str]:
        assert token == "github-access-token"
        return (f"github-account-{email}", email)

    async def fake_get_github_user_profile(token: str) -> GitHubUserProfile:
        assert token == "github-access-token"
        return GitHubUserProfile(
            login=f"github-{email.split('@')[0]}",
            avatar_url="https://avatars.githubusercontent.com/u/583231?v=4",
            display_name="GitHub Tester",
        )

    monkeypatch.setattr(
        github_oauth_client,
        "get_authorization_url",
        fake_get_authorization_url,
    )
    monkeypatch.setattr(github_oauth_client, "get_access_token", fake_get_access_token)
    monkeypatch.setattr(github_oauth_client, "get_id_email", fake_get_id_email)
    monkeypatch.setattr(
        identity_providers,
        "get_github_user_profile",
        fake_get_github_user_profile,
    )


@pytest.mark.asyncio
async def test_web_password_login_rejects_non_beta_email(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "password_auth_enabled", True)
    monkeypatch.setattr(settings, "web_beta_allowed_emails", "")
    monkeypatch.setattr(settings, "web_beta_allowed_domains", "beta.example.com")
    await _create_password_user("not-beta@example.com", "password1234")

    response = await client.post(
        "/auth/web/password/login",
        json={"email": "not-beta@example.com", "password": "password1234"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == WEB_BETA_EMAIL_NOT_ALLOWED_CODE
    assert "proliferate_web_refresh" not in response.headers.get("set-cookie", "")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("email", "allowed_emails", "allowed_domains"),
    [
        ("exact-beta@example.com", " exact-beta@example.com ", ""),
        ("domain-beta@team.example.com", "", " @team.example.com "),
    ],
)
async def test_web_password_login_accepts_beta_email_or_domain(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    email: str,
    allowed_emails: str,
    allowed_domains: str,
) -> None:
    monkeypatch.setattr(settings, "password_auth_enabled", True)
    monkeypatch.setattr(settings, "web_beta_allowed_emails", allowed_emails)
    monkeypatch.setattr(settings, "web_beta_allowed_domains", allowed_domains)
    await _create_password_user(email, "password1234")

    response = await client.post(
        "/auth/web/password/login",
        json={"email": email, "password": "password1234"},
    )

    assert response.status_code == 200
    assert "proliferate_web_refresh" in response.headers["set-cookie"]


@pytest.mark.asyncio
async def test_web_session_bootstrap_rechecks_beta_allowlist_for_existing_cookie(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "password_auth_enabled", True)
    monkeypatch.setattr(settings, "web_beta_allowed_emails", "")
    monkeypatch.setattr(settings, "web_beta_allowed_domains", "example.com")
    await _create_password_user("existing-cookie@example.com", "password1234")
    response = await client.post(
        "/auth/web/password/login",
        json={"email": "existing-cookie@example.com", "password": "password1234"},
    )
    assert response.status_code == 200

    monkeypatch.setattr(settings, "web_beta_allowed_domains", "beta.example.com")
    bootstrap = await client.post("/auth/web/session/bootstrap")

    assert bootstrap.status_code == 403
    assert bootstrap.json()["detail"]["code"] == WEB_BETA_EMAIL_NOT_ALLOWED_CODE


@pytest.mark.asyncio
async def test_web_beta_allowlist_applies_to_web_token_not_desktop_token(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = await _create_user("token-non-beta@example.com")
    monkeypatch.setattr(settings, "web_beta_allowed_emails", "")
    monkeypatch.setattr(settings, "web_beta_allowed_domains", "beta.example.com")

    web_verifier, web_challenge = _make_pkce_pair()
    web_code = await _create_desktop_auth_code_for_user(
        user_id=user_id,
        state="web-beta-denied-state",
        code_challenge=web_challenge,
    )
    web_response = await client.post(
        "/auth/web/token",
        json={
            "code": web_code,
            "codeVerifier": web_verifier,
            "grantType": "authorization_code",
        },
    )

    assert web_response.status_code == 403
    assert web_response.json()["detail"]["code"] == WEB_BETA_EMAIL_NOT_ALLOWED_CODE

    desktop_verifier, desktop_challenge = _make_pkce_pair()
    desktop_code = await _create_desktop_auth_code_for_user(
        user_id=user_id,
        state="desktop-beta-bypass-state",
        code_challenge=desktop_challenge,
    )
    desktop_response = await client.post(
        "/auth/desktop/token",
        json={
            "code": desktop_code,
            "code_verifier": desktop_verifier,
            "grant_type": "authorization_code",
        },
    )

    assert desktop_response.status_code == 200
    assert desktop_response.json()["user"]["email"] == "token-non-beta@example.com"


@pytest.mark.asyncio
async def test_web_github_login_redirects_to_beta_error_when_email_denied(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, challenge = _make_pkce_pair()
    monkeypatch.setattr(settings, "web_beta_allowed_emails", "")
    monkeypatch.setattr(settings, "web_beta_allowed_domains", "beta.example.com")
    _enable_identity_github(monkeypatch, "not-beta-github@example.com")

    started = await client.post(
        "/auth/web/github/start",
        json={
            "purpose": "login",
            "clientState": "web-beta-denied-state",
            "codeChallenge": challenge,
            "codeChallengeMethod": "S256",
            "redirectUri": "http://localhost:5174/auth/callback",
        },
    )
    assert started.status_code == 200
    oauth_state = parse_qs(urlparse(started.json()["authorizationUrl"]).query)["state"][0]

    callback = await client.get(
        "/auth/github/callback",
        params={"code": "github-code", "state": oauth_state},
        follow_redirects=False,
    )

    assert callback.status_code == 302
    redirect = urlparse(callback.headers["location"])
    assert redirect.path == "/auth/error"
    assert parse_qs(redirect.query)["code"] == [WEB_BETA_EMAIL_NOT_ALLOWED_CODE]


@pytest.mark.asyncio
async def test_web_github_login_uses_existing_account_email_for_beta_gate(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    verifier, challenge = _make_pkce_pair()
    user_id = await _create_user("linked-account@beta.example.com")
    await _link_github_identity(user_id, provider_email="provider-email@example.com")
    monkeypatch.setattr(settings, "web_beta_allowed_emails", "")
    monkeypatch.setattr(settings, "web_beta_allowed_domains", "beta.example.com")
    _enable_identity_github(monkeypatch, "provider-email@example.com")

    started = await client.post(
        "/auth/web/github/start",
        json={
            "purpose": "login",
            "clientState": "web-linked-account-state",
            "codeChallenge": challenge,
            "codeChallengeMethod": "S256",
            "redirectUri": "http://localhost:5174/auth/callback",
        },
    )
    assert started.status_code == 200
    oauth_state = parse_qs(urlparse(started.json()["authorizationUrl"]).query)["state"][0]

    callback = await client.get(
        "/auth/github/callback",
        params={"code": "github-code", "state": oauth_state},
        follow_redirects=False,
    )
    assert callback.status_code == 302
    callback_query = parse_qs(urlparse(callback.headers["location"]).query)

    token = await client.post(
        "/auth/web/token",
        json={
            "code": callback_query["code"][0],
            "codeVerifier": verifier,
            "grantType": "authorization_code",
        },
    )

    assert token.status_code == 200
    assert token.json()["user"]["email"] == "linked-account@beta.example.com"


@pytest.mark.asyncio
async def test_web_github_login_rejects_denied_existing_account_email(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, challenge = _make_pkce_pair()
    user_id = await _create_user("linked-account@example.com")
    await _link_github_identity(user_id, provider_email="provider-email@beta.example.com")
    monkeypatch.setattr(settings, "web_beta_allowed_emails", "")
    monkeypatch.setattr(settings, "web_beta_allowed_domains", "beta.example.com")
    _enable_identity_github(monkeypatch, "provider-email@beta.example.com")

    started = await client.post(
        "/auth/web/github/start",
        json={
            "purpose": "login",
            "clientState": "web-linked-account-denied-state",
            "codeChallenge": challenge,
            "codeChallengeMethod": "S256",
            "redirectUri": "http://localhost:5174/auth/callback",
        },
    )
    assert started.status_code == 200
    oauth_state = parse_qs(urlparse(started.json()["authorizationUrl"]).query)["state"][0]

    callback = await client.get(
        "/auth/github/callback",
        params={"code": "github-code", "state": oauth_state},
        follow_redirects=False,
    )

    assert callback.status_code == 302
    redirect = urlparse(callback.headers["location"])
    assert redirect.path == "/auth/error"
    assert parse_qs(redirect.query)["code"] == [WEB_BETA_EMAIL_NOT_ALLOWED_CODE]


@pytest.mark.asyncio
async def test_desktop_github_login_is_not_beta_gated(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, challenge = _make_pkce_pair()
    monkeypatch.setattr(settings, "web_beta_allowed_emails", "")
    monkeypatch.setattr(settings, "web_beta_allowed_domains", "beta.example.com")
    _enable_identity_github(monkeypatch, "desktop-non-beta@example.com")

    started = await client.post(
        "/auth/desktop/github/start",
        json={
            "purpose": "login",
            "clientState": "desktop-beta-bypass-state",
            "codeChallenge": challenge,
            "codeChallengeMethod": "S256",
            "redirectUri": "proliferate://auth/callback",
        },
    )
    assert started.status_code == 200
    oauth_state = parse_qs(urlparse(started.json()["authorizationUrl"]).query)["state"][0]

    callback = await client.get(
        "/auth/github/callback",
        params={"code": "github-code", "state": oauth_state},
        follow_redirects=False,
    )

    assert callback.status_code == 302
    redirect = urlparse(callback.headers["location"])
    assert f"{redirect.scheme}://{redirect.netloc}{redirect.path}" == (
        "proliferate://auth/callback"
    )
    assert parse_qs(redirect.query)["state"] == ["desktop-beta-bypass-state"]
