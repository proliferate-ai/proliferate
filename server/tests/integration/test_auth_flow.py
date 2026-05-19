"""Integration tests for the auth flow: GitHub OAuth → desktop PKCE exchange."""

import base64
import hashlib
import time
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import pytest
from fastapi import HTTPException
from fastapi_users.jwt import generate_jwt
from httpx import AsyncClient
from sqlalchemy import select

from proliferate.auth.desktop.models import AuthorizeParams
from proliferate.auth.desktop import service as desktop_service
from proliferate.auth.identity import providers as identity_providers
from proliferate.auth.identity.service import WEB_CSRF_COOKIE
from proliferate.auth.oauth import github_oauth_client
from proliferate.auth.oauth import google_oauth_client
from proliferate.config import settings
from proliferate.constants.auth import DESKTOP_GITHUB_CSRF_COOKIE, REFRESH_TOKEN_LIFETIME_SECONDS
from proliferate.db.models.auth import AuthIdentity, ProviderGrant, User
from proliferate.integrations.github import GitHubUserProfile
from proliferate.utils.crypto import encrypt_text


def _make_pkce_pair() -> tuple[str, str]:
    """Generate a PKCE verifier + challenge pair."""
    verifier = "test-code-verifier-that-is-long-enough-for-pkce"
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


async def _create_user_via_manager(
    email: str,
    *,
    display_name: str | None = None,
    is_active: bool = True,
) -> str:
    """Create a test user directly in the current test database."""
    from proliferate.db import engine as engine_module
    from proliferate.db.models.auth import User

    async with engine_module.async_session_factory() as session:
        user = User(
            email=email,
            hashed_password="unused-oauth-only",
            is_active=is_active,
            is_superuser=False,
            is_verified=True,
            display_name=display_name or "Desktop Tester",
        )
        session.add(user)
        await session.commit()
    return str(user.id)


async def _link_ready_github_identity(
    user_id: str,
    *,
    subject: str,
    email: str,
) -> None:
    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        identity = AuthIdentity(
            user_id=UUID(user_id),
            provider="github",
            provider_subject=subject,
            email=email,
            email_verified=True,
        )
        session.add(identity)
        await session.flush()
        session.add(
            ProviderGrant(
                user_id=UUID(user_id),
                auth_identity_id=identity.id,
                provider="github",
                access_token_ciphertext=encrypt_text("github-access-token"),
                scopes_json='["repo","user","user:email"]',
                status="ready",
            )
        )
        await session.commit()


async def _access_token_for_user(
    client: AsyncClient,
    *,
    user_id: str,
    state: str,
) -> str:
    verifier, challenge = _make_pkce_pair()
    code = await _create_desktop_auth_code_for_user(
        user_id=user_id,
        state=state,
        code_challenge=challenge,
    )
    token = await client.post(
        "/auth/desktop/token",
        json={
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
        },
    )
    assert token.status_code == 200
    return str(token.json()["access_token"])


async def _create_desktop_auth_code_for_user(
    *,
    user_id: str,
    state: str,
    code_challenge: str,
    code_challenge_method: str = "S256",
    redirect_uri: str = "proliferate://auth/callback",
) -> str:
    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        auth_code = await desktop_service.create_desktop_auth_code(
            session,
            AuthorizeParams(
                state=state,
                code_challenge=code_challenge,
                code_challenge_method=code_challenge_method,
                redirect_uri=redirect_uri,
            ),
            UUID(user_id),
        )
        await session.commit()
        return auth_code.code


class TestHealthEndpoint:
    @pytest.mark.asyncio
    async def test_health(self, client: AsyncClient) -> None:
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"

    @pytest.mark.asyncio
    async def test_cors_preflight_allows_desktop_dev_origin(self, client: AsyncClient) -> None:
        resp = await client.options(
            "/health",
            headers={
                "Origin": "http://localhost:1420",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "http://localhost:1420"
        assert resp.headers["access-control-allow-credentials"] == "true"


class TestEmailPasswordRoutesRemoved:
    @pytest.mark.asyncio
    async def test_register_endpoint_gone(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/auth/register",
            json={"email": "x@example.com", "password": "password123"},
        )
        assert resp.status_code in (404, 405)

    @pytest.mark.asyncio
    async def test_login_endpoint_gone(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/auth/login",
            data={"username": "x@example.com", "password": "password123"},
        )
        assert resp.status_code in (404, 405)

    @pytest.mark.asyncio
    async def test_desktop_login_endpoint_gone(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/auth/desktop/login",
            json={"email": "x@example.com", "password": "password123"},
        )
        assert resp.status_code in (404, 405)

    @pytest.mark.asyncio
    async def test_protected_endpoint_without_token(self, client: AsyncClient) -> None:
        resp = await client.get("/v1/cloud/workspaces")
        assert resp.status_code == 401


class TestDesktopPKCEFlow:
    """Test the full desktop PKCE authorization code exchange."""

    @pytest.mark.asyncio
    async def test_full_pkce_flow(self, client: AsyncClient) -> None:
        """Simulate the complete desktop login flow."""
        user_id = await _create_user_via_manager("desktop@example.com")
        verifier, challenge = _make_pkce_pair()

        # Step 1: Server creates auth code (normally after browser login)
        code = await _create_desktop_auth_code_for_user(
            user_id=user_id,
            state="random-state-string",
            code_challenge=challenge,
        )

        # Step 2: Desktop exchanges code + verifier for JWT
        resp = await client.post(
            "/auth/desktop/token",
            json={
                "code": code,
                "code_verifier": verifier,
                "grant_type": "authorization_code",
            },
        )
        assert resp.status_code == 200
        token_data = resp.json()
        assert "access_token" in token_data
        assert "refresh_token" in token_data
        assert token_data["token_type"] == "bearer"
        assert token_data["expires_in"] > 0
        assert token_data["user"]["email"] == "desktop@example.com"

        # Step 3: A raw desktop token is authenticated but still limited until
        # the user has linked the GitHub product identity.
        resp = await client.get(
            "/v1/cloud/workspaces",
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
        )
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "github_link_required"

    @pytest.mark.asyncio
    async def test_pkce_wrong_verifier(self, client: AsyncClient) -> None:
        user_id = await _create_user_via_manager("pkce-wrong@example.com")
        _, challenge = _make_pkce_pair()

        code = await _create_desktop_auth_code_for_user(
            user_id=user_id,
            state="state-1",
            code_challenge=challenge,
        )

        # Use wrong verifier
        resp = await client.post(
            "/auth/desktop/token",
            json={
                "code": code,
                "code_verifier": "completely-wrong-verifier",
                "grant_type": "authorization_code",
            },
        )
        assert resp.status_code == 400
        assert "PKCE" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_code_cannot_be_reused(self, client: AsyncClient) -> None:
        user_id = await _create_user_via_manager("reuse@example.com")
        verifier, challenge = _make_pkce_pair()

        code = await _create_desktop_auth_code_for_user(
            user_id=user_id,
            state="state-2",
            code_challenge=challenge,
        )

        # First exchange — should work
        resp = await client.post(
            "/auth/desktop/token",
            json={
                "code": code,
                "code_verifier": verifier,
                "grant_type": "authorization_code",
            },
        )
        assert resp.status_code == 200

        # Second exchange — code consumed
        resp = await client.post(
            "/auth/desktop/token",
            json={
                "code": code,
                "code_verifier": verifier,
                "grant_type": "authorization_code",
            },
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_invalid_code(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/auth/desktop/token",
            json={
                "code": "nonexistent-code",
                "code_verifier": "whatever",
                "grant_type": "authorization_code",
            },
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_unsupported_challenge_method(self, client: AsyncClient) -> None:
        user_id = await _create_user_via_manager("badmethod@example.com")
        with pytest.raises(HTTPException) as exc_info:
            await _create_desktop_auth_code_for_user(
                user_id=user_id,
                state="state-3",
                code_challenge="whatever",
                code_challenge_method="plain",
            )
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_debug_authorize_endpoint_disabled_outside_debug(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        user_id = await _create_user_via_manager("debug-authorize-off@example.com")
        _, challenge = _make_pkce_pair()
        monkeypatch.setattr(settings, "debug", False)

        resp = await client.post(
            "/auth/desktop/authorize",
            params={"user_id": user_id},
            json={
                "state": "state-debug-off",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "redirect_uri": "proliferate://auth/callback",
            },
        )

        assert resp.status_code == 404


class TestWebMobileSessionGuards:
    @pytest.mark.asyncio
    async def test_web_token_exchange_rejects_inactive_user(self, client: AsyncClient) -> None:
        user_id = await _create_user_via_manager(
            "inactive-web-token@example.com",
            is_active=False,
        )
        verifier, challenge = _make_pkce_pair()

        code = await _create_desktop_auth_code_for_user(
            user_id=user_id,
            state="inactive-web-state",
            code_challenge=challenge,
        )

        response = await client.post(
            "/auth/web/token",
            json={
                "code": code,
                "code_verifier": verifier,
                "grant_type": "authorization_code",
            },
        )

        assert response.status_code == 403
        assert response.json()["detail"] == "User is inactive."

    @pytest.mark.asyncio
    async def test_mobile_refresh_rejects_inactive_user(self, client: AsyncClient) -> None:
        user_id = await _create_user_via_manager(
            "inactive-mobile-refresh@example.com",
            is_active=False,
        )
        refresh_token = generate_jwt(
            data={"sub": user_id, "aud": "proliferate:refresh"},
            secret=settings.jwt_secret,
            lifetime_seconds=REFRESH_TOKEN_LIFETIME_SECONDS,
        )

        response = await client.post(
            "/auth/mobile/session/refresh",
            json={
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )

        assert response.status_code == 403
        assert response.json()["detail"] == "User is inactive."


class TestDesktopGitHubBrowserFlow:
    @staticmethod
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
            url = (
                "https://github.com/login/oauth/authorize"
                f"?state={state}&redirect_uri={redirect_uri}"
            )
            if extras_params:
                url += "".join(f"&{key}={value}" for key, value in extras_params.items())
            return url

        async def fake_get_access_token(code: str, redirect_uri: str) -> dict[str, object]:
            assert code == "github-code"
            assert redirect_uri.endswith("/auth/desktop/github/callback")
            return {
                "access_token": "github-access-token",
                "expires_at": int(time.time()) + 3600,
                "scope": "repo,user,user:email",
            }

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
        monkeypatch.setattr(
            desktop_service,
            "get_github_user_profile",
            fake_get_github_user_profile,
        )

    @pytest.mark.asyncio
    async def test_github_availability_when_disabled(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "github_oauth_client_id", "")
        monkeypatch.setattr(settings, "github_oauth_client_secret", "")
        resp = await client.get("/auth/desktop/github/availability")
        assert resp.status_code == 200
        assert resp.json() == {"enabled": False, "client_id": None}

    @pytest.mark.asyncio
    async def test_github_availability_includes_client_id_when_enabled(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "github_oauth_client_id", "github-client-id")
        monkeypatch.setattr(settings, "github_oauth_client_secret", "github-client-secret")
        resp = await client.get("/auth/desktop/github/availability")
        assert resp.status_code == 200
        assert resp.json() == {"enabled": True, "client_id": "github-client-id"}

    @pytest.mark.asyncio
    async def test_github_browser_flow_stages_and_exchanges_desktop_session(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        verifier, challenge = _make_pkce_pair()
        self._enable_github(monkeypatch, "desktop-github@example.com")

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

        pending = await client.post(
            "/auth/desktop/poll",
            json={
                "state": "desktop-github-state",
                "code_verifier": verifier,
            },
        )
        assert pending.status_code == 202
        assert pending.json() == {"status": "pending"}

        callback = await client.get(
            "/auth/desktop/github/callback",
            params={"code": "github-code", "state": oauth_state},
        )
        assert callback.status_code == 200
        assert "Opening Proliferate..." in callback.text
        assert "Open Proliferate again" in callback.text
        assert "proliferate://auth/callback?code=" in callback.text
        assert "state=desktop-github-state" in callback.text

        exchange = await client.post(
            "/auth/desktop/poll",
            json={
                "state": "desktop-github-state",
                "code_verifier": verifier,
            },
        )
        assert exchange.status_code == 200
        token_data = exchange.json()
        assert token_data["user"]["email"] == "desktop-github@example.com"
        assert token_data["user"]["github_login"] == "github-desktop-github"
        assert token_data["user"]["avatar_url"] == (
            "https://avatars.githubusercontent.com/u/583231?v=4"
        )

        protected = await client.get(
            "/v1/cloud/workspaces",
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
        )
        assert protected.status_code == 200

    @pytest.mark.asyncio
    async def test_github_browser_flow_supports_select_account_prompt(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        verifier, challenge = _make_pkce_pair()
        self._enable_github(monkeypatch, "desktop-github@example.com")

        authorize = await client.get(
            "/auth/desktop/github/authorize",
            params={
                "state": "desktop-github-state",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "redirect_uri": "proliferate://auth/callback",
                "prompt": "select_account",
            },
            follow_redirects=False,
        )
        assert authorize.status_code == 302
        query = parse_qs(urlparse(authorize.headers["location"]).query)
        assert query["prompt"] == ["select_account"]

    @pytest.mark.asyncio
    async def test_github_browser_flow_associates_existing_user(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        await _create_user_via_manager("linked@example.com")

        verifier, challenge = _make_pkce_pair()
        self._enable_github(monkeypatch, "linked@example.com")

        authorize = await client.get(
            "/auth/desktop/github/authorize",
            params={
                "state": "linked-github-state",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "redirect_uri": "proliferate://auth/callback",
            },
            follow_redirects=False,
        )
        oauth_state = parse_qs(urlparse(authorize.headers["location"]).query)["state"][0]

        callback = await client.get(
            "/auth/desktop/github/callback",
            params={"code": "github-code", "state": oauth_state},
        )
        assert callback.status_code == 200
        assert "Opening Proliferate..." in callback.text

        exchange = await client.post(
            "/auth/desktop/poll",
            json={
                "state": "linked-github-state",
                "code_verifier": verifier,
            },
        )
        assert exchange.status_code == 200
        assert exchange.json()["user"]["email"] == "linked@example.com"

    @pytest.mark.asyncio
    async def test_github_browser_flow_uses_configured_api_base_url_for_callback(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        verifier, challenge = _make_pkce_pair()
        self._enable_github(monkeypatch, "desktop-github@example.com")
        monkeypatch.setattr(settings, "api_base_url", "https://app.proliferate.com/api")

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

        redirect_uri = parse_qs(urlparse(authorize.headers["location"]).query)["redirect_uri"][0]
        assert redirect_uri == "https://app.proliferate.com/api/auth/desktop/github/callback"
        assert "Secure" in authorize.headers["set-cookie"]

        oauth_state = parse_qs(urlparse(authorize.headers["location"]).query)["state"][0]
        csrf_cookie = authorize.cookies.get(DESKTOP_GITHUB_CSRF_COOKIE)
        assert csrf_cookie is not None

        callback = await client.get(
            "/auth/desktop/github/callback",
            params={"code": "github-code", "state": oauth_state},
            cookies={DESKTOP_GITHUB_CSRF_COOKIE: csrf_cookie},
        )
        assert callback.status_code == 200

        exchange = await client.post(
            "/auth/desktop/poll",
            json={
                "state": "desktop-github-state",
                "code_verifier": verifier,
            },
        )
        assert exchange.status_code == 200
        assert exchange.json()["user"]["email"] == "desktop-github@example.com"


class TestWebMobileProductAuthFlow:
    @staticmethod
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
                "https://github.com/login/oauth/authorize"
                f"?state={state}&redirect_uri={redirect_uri}"
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

    @staticmethod
    def _enable_google(
        monkeypatch: pytest.MonkeyPatch,
        email: str,
        *,
        expected_surface: str = "web",
    ) -> None:
        monkeypatch.setattr(settings, "google_oauth_client_id", "google-client-id")
        monkeypatch.setattr(settings, "google_oauth_client_secret", "google-client-secret")

        async def fake_get_authorization_url(
            redirect_uri: str,
            state: str | None = None,
            scope: list[str] | None = None,
            code_challenge: str | None = None,
            code_challenge_method: str | None = None,
            extras_params: dict[str, str] | None = None,
        ) -> str:
            assert redirect_uri.endswith(f"/auth/{expected_surface}/google/callback")
            assert scope == ["openid", "email", "profile"]
            assert code_challenge is None
            assert code_challenge_method is None
            assert state is not None
            return (
                "https://accounts.google.com/o/oauth2/v2/auth"
                f"?state={state}&redirect_uri={redirect_uri}"
            )

        async def fake_get_access_token(code: str, redirect_uri: str) -> dict[str, object]:
            assert code == "google-code"
            assert redirect_uri.endswith(f"/auth/{expected_surface}/google/callback")
            return {"access_token": "google-access-token", "scope": "openid email profile"}

        async def fake_get_id_email(token: str) -> tuple[str, str]:
            assert token == "google-access-token"
            return (f"google-account-{email}", email)

        monkeypatch.setattr(
            google_oauth_client,
            "get_authorization_url",
            fake_get_authorization_url,
        )
        monkeypatch.setattr(google_oauth_client, "get_access_token", fake_get_access_token)
        monkeypatch.setattr(google_oauth_client, "get_id_email", fake_get_id_email)

    @pytest.mark.asyncio
    async def test_web_github_login_sets_cookie_session_and_product_identity(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        verifier, challenge = _make_pkce_pair()
        self._enable_identity_github(monkeypatch, "web-github@example.com")

        started = await client.post(
            "/auth/web/github/start",
            json={
                "purpose": "login",
                "clientState": "web-client-state",
                "codeChallenge": challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "http://localhost:5174/auth/callback",
                "prompt": "select_account",
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
        assert callback_query["state"] == ["web-client-state"]

        token = await client.post(
            "/auth/web/token",
            json={
                "code": callback_query["code"][0],
                "codeVerifier": verifier,
                "grantType": "authorization_code",
            },
        )
        assert token.status_code == 200
        payload = token.json()
        assert payload["refreshToken"] is None
        assert payload["readiness"]["productReady"] is True
        assert "proliferate_web_refresh" in token.headers["set-cookie"]

        bootstrap = await client.post("/auth/web/session/bootstrap")
        assert bootstrap.status_code == 200
        assert bootstrap.json()["readiness"]["productReady"] is True

        csrf = client.cookies.get(WEB_CSRF_COOKIE)
        assert csrf is not None
        refreshed = await client.post(
            "/auth/web/session/refresh",
            headers={"x-proliferate-csrf": csrf},
        )
        assert refreshed.status_code == 200

        protected = await client.get(
            "/v1/cloud/workspaces",
            headers={"Authorization": f"Bearer {payload['accessToken']}"},
        )
        assert protected.status_code == 200

    @pytest.mark.asyncio
    async def test_web_google_login_requires_github_then_links_github(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        google_verifier, google_challenge = _make_pkce_pair()
        self._enable_google(monkeypatch, "google-web@example.com")

        google_start = await client.post(
            "/auth/web/google/start",
            json={
                "purpose": "login",
                "clientState": "google-client-state",
                "codeChallenge": google_challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "http://localhost:5174/auth/callback",
            },
        )
        oauth_state = parse_qs(urlparse(google_start.json()["authorizationUrl"]).query)["state"][0]

        google_callback = await client.get(
            "/auth/web/google/callback",
            params={"code": "google-code", "state": oauth_state},
            follow_redirects=False,
        )
        google_query = parse_qs(urlparse(google_callback.headers["location"]).query)
        google_token = await client.post(
            "/auth/web/token",
            json={
                "code": google_query["code"][0],
                "codeVerifier": google_verifier,
                "grantType": "authorization_code",
            },
        )
        assert google_token.status_code == 200
        google_payload = google_token.json()
        assert google_payload["readiness"]["productReady"] is False

        blocked = await client.get(
            "/v1/cloud/workspaces",
            headers={"Authorization": f"Bearer {google_payload['accessToken']}"},
        )
        assert blocked.status_code == 403
        assert blocked.json()["detail"]["code"] == "github_link_required"

        github_verifier, github_challenge = _make_pkce_pair()
        self._enable_identity_github(monkeypatch, "github-for-google@example.com")
        github_start = await client.post(
            "/auth/web/github/start",
            headers={"Authorization": f"Bearer {google_payload['accessToken']}"},
            json={
                "purpose": "required_github_link",
                "clientState": "github-link-client-state",
                "codeChallenge": github_challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "http://localhost:5174/auth/callback",
            },
        )
        assert github_start.status_code == 200
        github_state = parse_qs(urlparse(github_start.json()["authorizationUrl"]).query)["state"][
            0
        ]
        github_callback = await client.get(
            "/auth/web/github/callback",
            params={"code": "github-code", "state": github_state},
            follow_redirects=False,
        )
        github_query = parse_qs(urlparse(github_callback.headers["location"]).query)
        linked_token = await client.post(
            "/auth/web/token",
            json={
                "code": github_query["code"][0],
                "codeVerifier": github_verifier,
                "grantType": "authorization_code",
            },
        )
        assert linked_token.status_code == 200
        assert linked_token.json()["readiness"]["productReady"] is True

    @pytest.mark.asyncio
    async def test_logged_out_github_login_claims_same_email_limited_user(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        google_verifier, google_challenge = _make_pkce_pair()
        self._enable_google(monkeypatch, "same-email-claim@example.com")
        google_start = await client.post(
            "/auth/web/google/start",
            json={
                "purpose": "login",
                "clientState": "same-email-google-state",
                "codeChallenge": google_challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "http://localhost:5174/auth/callback",
            },
        )
        assert google_start.status_code == 200
        google_state = parse_qs(urlparse(google_start.json()["authorizationUrl"]).query)["state"][
            0
        ]
        google_callback = await client.get(
            "/auth/web/google/callback",
            params={"code": "google-code", "state": google_state},
            follow_redirects=False,
        )
        google_query = parse_qs(urlparse(google_callback.headers["location"]).query)
        google_token = await client.post(
            "/auth/web/token",
            json={
                "code": google_query["code"][0],
                "codeVerifier": google_verifier,
                "grantType": "authorization_code",
            },
        )
        assert google_token.status_code == 200
        limited_user_id = google_token.json()["user"]["id"]
        assert google_token.json()["readiness"]["productReady"] is False

        github_verifier, github_challenge = _make_pkce_pair()
        self._enable_identity_github(monkeypatch, "same-email-claim@example.com")
        github_start = await client.post(
            "/auth/web/github/start",
            json={
                "purpose": "login",
                "clientState": "same-email-github-state",
                "codeChallenge": github_challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "http://localhost:5174/auth/callback",
            },
        )
        assert github_start.status_code == 200
        github_state = parse_qs(urlparse(github_start.json()["authorizationUrl"]).query)["state"][
            0
        ]
        github_callback = await client.get(
            "/auth/web/github/callback",
            params={"code": "github-code", "state": github_state},
            follow_redirects=False,
        )
        github_query = parse_qs(urlparse(github_callback.headers["location"]).query)
        github_token = await client.post(
            "/auth/web/token",
            json={
                "code": github_query["code"][0],
                "codeVerifier": github_verifier,
                "grantType": "authorization_code",
            },
        )
        assert github_token.status_code == 200
        assert github_token.json()["user"]["id"] == limited_user_id
        assert github_token.json()["readiness"]["productReady"] is True

    @pytest.mark.asyncio
    async def test_required_github_link_merges_into_existing_github_user(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        existing_github_email = "existing-github-merge@example.com"
        existing_github_subject = f"github-account-{existing_github_email}"
        existing_user_id = await _create_user_via_manager(existing_github_email)
        await _link_ready_github_identity(
            existing_user_id,
            subject=existing_github_subject,
            email=existing_github_email,
        )

        google_verifier, google_challenge = _make_pkce_pair()
        self._enable_google(monkeypatch, "limited-google-merge@example.com")
        google_start = await client.post(
            "/auth/web/google/start",
            json={
                "purpose": "login",
                "clientState": "merge-google-state",
                "codeChallenge": google_challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "http://localhost:5174/auth/callback",
            },
        )
        assert google_start.status_code == 200
        google_state = parse_qs(urlparse(google_start.json()["authorizationUrl"]).query)["state"][
            0
        ]
        google_callback = await client.get(
            "/auth/web/google/callback",
            params={"code": "google-code", "state": google_state},
            follow_redirects=False,
        )
        google_query = parse_qs(urlparse(google_callback.headers["location"]).query)
        google_token = await client.post(
            "/auth/web/token",
            json={
                "code": google_query["code"][0],
                "codeVerifier": google_verifier,
                "grantType": "authorization_code",
            },
        )
        assert google_token.status_code == 200
        limited_user_id = google_token.json()["user"]["id"]
        assert limited_user_id != existing_user_id
        assert google_token.json()["readiness"]["productReady"] is False

        github_verifier, github_challenge = _make_pkce_pair()
        self._enable_identity_github(monkeypatch, existing_github_email)
        link_start = await client.post(
            "/auth/github/link/start",
            headers={"Authorization": f"Bearer {google_token.json()['accessToken']}"},
            json={
                "purpose": "required_github_link",
                "clientState": "merge-github-state",
                "codeChallenge": github_challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "http://localhost:5174/auth/callback",
            },
        )
        assert link_start.status_code == 200
        link_state = parse_qs(urlparse(link_start.json()["authorizationUrl"]).query)["state"][0]
        link_callback = await client.get(
            "/auth/web/github/callback",
            params={"code": "github-code", "state": link_state},
            follow_redirects=False,
        )
        assert link_callback.status_code == 302
        link_query = parse_qs(urlparse(link_callback.headers["location"]).query)
        merged_token = await client.post(
            "/auth/web/token",
            json={
                "code": link_query["code"][0],
                "codeVerifier": github_verifier,
                "grantType": "authorization_code",
            },
        )
        assert merged_token.status_code == 200
        assert merged_token.json()["user"]["id"] == existing_user_id
        assert merged_token.json()["readiness"]["productReady"] is True

        viewer = await client.get(
            "/v1/auth/viewer",
            headers={"Authorization": f"Bearer {merged_token.json()['accessToken']}"},
        )
        assert viewer.status_code == 200
        linked = viewer.json()["linkedProviders"]
        assert any(
            provider["provider"] == "google"
            and provider["accountEmail"] == "limited-google-merge@example.com"
            for provider in linked
        )
        assert any(
            provider["provider"] == "github" and provider["accountId"] == existing_github_subject
            for provider in linked
        )

        from proliferate.db import engine as engine_module

        async with engine_module.async_session_factory() as session:
            source_user = await session.get(User, UUID(limited_user_id))
            assert source_user is not None
            assert source_user.is_active is False
            source_identities = await session.execute(
                select(AuthIdentity).where(AuthIdentity.user_id == UUID(limited_user_id))
            )
            assert list(source_identities.scalars().all()) == []

    @pytest.mark.asyncio
    async def test_linking_google_to_github_user_claims_limited_google_user(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        google_verifier, google_challenge = _make_pkce_pair()
        self._enable_google(monkeypatch, "claimed-google-link@example.com")
        google_start = await client.post(
            "/auth/web/google/start",
            json={
                "purpose": "login",
                "clientState": "claimed-google-state",
                "codeChallenge": google_challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "http://localhost:5174/auth/callback",
            },
        )
        assert google_start.status_code == 200
        google_state = parse_qs(urlparse(google_start.json()["authorizationUrl"]).query)["state"][
            0
        ]
        google_callback = await client.get(
            "/auth/web/google/callback",
            params={"code": "google-code", "state": google_state},
            follow_redirects=False,
        )
        google_query = parse_qs(urlparse(google_callback.headers["location"]).query)
        google_token = await client.post(
            "/auth/web/token",
            json={
                "code": google_query["code"][0],
                "codeVerifier": google_verifier,
                "grantType": "authorization_code",
            },
        )
        assert google_token.status_code == 200
        limited_user_id = google_token.json()["user"]["id"]

        target_user_id = await _create_user_via_manager("target-github-link@example.com")
        await _link_ready_github_identity(
            target_user_id,
            subject="github-account-target-github-link@example.com",
            email="target-github-link@example.com",
        )
        target_access_token = await _access_token_for_user(
            client,
            user_id=target_user_id,
            state="target-link-google-state",
        )

        link_verifier, link_challenge = _make_pkce_pair()
        self._enable_google(monkeypatch, "claimed-google-link@example.com")
        link_start = await client.post(
            "/auth/web/google/start",
            headers={"Authorization": f"Bearer {target_access_token}"},
            json={
                "purpose": "link",
                "clientState": "target-google-link-state",
                "codeChallenge": link_challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "http://localhost:5174/auth/callback",
            },
        )
        assert link_start.status_code == 200
        link_state = parse_qs(urlparse(link_start.json()["authorizationUrl"]).query)["state"][0]
        link_callback = await client.get(
            "/auth/web/google/callback",
            params={"code": "google-code", "state": link_state},
            follow_redirects=False,
        )
        assert link_callback.status_code == 302
        link_query = parse_qs(urlparse(link_callback.headers["location"]).query)
        linked_token = await client.post(
            "/auth/web/token",
            json={
                "code": link_query["code"][0],
                "codeVerifier": link_verifier,
                "grantType": "authorization_code",
            },
        )
        assert linked_token.status_code == 200
        assert linked_token.json()["user"]["id"] == target_user_id
        assert linked_token.json()["readiness"]["productReady"] is True

        from proliferate.db import engine as engine_module

        async with engine_module.async_session_factory() as session:
            source_user = await session.get(User, UUID(limited_user_id))
            assert source_user is not None
            assert source_user.is_active is False
            google_identity = await session.execute(
                select(AuthIdentity).where(
                    AuthIdentity.provider == "google",
                    AuthIdentity.provider_subject
                    == "google-account-claimed-google-link@example.com",
                )
            )
            assert google_identity.scalar_one().user_id == UUID(target_user_id)

    @pytest.mark.asyncio
    async def test_linking_existing_github_between_ready_users_is_rejected(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        source_email = "source-ready-github@example.com"
        target_email = "target-ready-github@example.com"
        source_user_id = await _create_user_via_manager(source_email)
        await _link_ready_github_identity(
            source_user_id,
            subject=f"github-account-{source_email}",
            email=source_email,
        )
        target_user_id = await _create_user_via_manager(target_email)
        await _link_ready_github_identity(
            target_user_id,
            subject=f"github-account-{target_email}",
            email=target_email,
        )
        source_access_token = await _access_token_for_user(
            client,
            user_id=source_user_id,
            state="source-ready-link-state",
        )

        self._enable_identity_github(monkeypatch, target_email)
        verifier, challenge = _make_pkce_pair()
        link_start = await client.post(
            "/auth/web/github/start",
            headers={"Authorization": f"Bearer {source_access_token}"},
            json={
                "purpose": "link",
                "clientState": "ready-github-collision-state",
                "codeChallenge": challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "http://localhost:5174/auth/callback",
            },
        )
        assert link_start.status_code == 200
        link_state = parse_qs(urlparse(link_start.json()["authorizationUrl"]).query)["state"][0]
        callback = await client.get(
            "/auth/web/github/callback",
            params={"code": "github-code", "state": link_state},
            follow_redirects=False,
        )
        assert callback.status_code == 409

        from proliferate.db import engine as engine_module

        async with engine_module.async_session_factory() as session:
            source_user = await session.get(User, UUID(source_user_id))
            target_user = await session.get(User, UUID(target_user_id))
            assert source_user is not None
            assert target_user is not None
            assert source_user.is_active is True
            assert target_user.is_active is True

    @pytest.mark.asyncio
    async def test_web_google_callback_uses_id_token_identity(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        verifier, challenge = _make_pkce_pair()
        monkeypatch.setattr(settings, "google_oauth_client_id", "google-client-id")
        monkeypatch.setattr(settings, "google_oauth_client_secret", "google-client-secret")

        async def fake_get_authorization_url(
            redirect_uri: str,
            state: str | None = None,
            scope: list[str] | None = None,
            code_challenge: str | None = None,
            code_challenge_method: str | None = None,
            extras_params: dict[str, str] | None = None,
        ) -> str:
            assert redirect_uri.endswith("/auth/web/google/callback")
            assert scope == ["openid", "email", "profile"]
            assert code_challenge is None
            assert code_challenge_method is None
            assert state is not None
            return (
                "https://accounts.google.com/o/oauth2/v2/auth"
                f"?state={state}&redirect_uri={redirect_uri}"
            )

        async def fake_get_access_token(code: str, redirect_uri: str) -> dict[str, object]:
            assert code == "google-code"
            assert redirect_uri.endswith("/auth/web/google/callback")
            return {
                "access_token": "google-access-token",
                "id_token": "google-id-token",
                "scope": "openid email profile",
            }

        async def fake_get_id_email(_token: str) -> tuple[str, str]:
            raise AssertionError(
                "Google profile endpoint should not be used when id_token exists."
            )

        async def fake_decode_google_id_token(id_token: str) -> dict[str, object]:
            assert id_token == "google-id-token"
            return {
                "sub": "google-subject-from-id-token",
                "email": "google-id-token@example.com",
                "email_verified": True,
                "name": "Google ID Token",
                "picture": "https://example.com/avatar.png",
                "iss": "https://accounts.google.com",
            }

        monkeypatch.setattr(
            google_oauth_client,
            "get_authorization_url",
            fake_get_authorization_url,
        )
        monkeypatch.setattr(google_oauth_client, "get_access_token", fake_get_access_token)
        monkeypatch.setattr(google_oauth_client, "get_id_email", fake_get_id_email)
        monkeypatch.setattr(
            identity_providers,
            "_decode_google_id_token",
            fake_decode_google_id_token,
        )

        started = await client.post(
            "/auth/web/google/start",
            json={
                "purpose": "login",
                "clientState": "google-id-token-client-state",
                "codeChallenge": challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "http://localhost:5174/auth/callback",
            },
        )
        assert started.status_code == 200
        oauth_state = parse_qs(urlparse(started.json()["authorizationUrl"]).query)["state"][0]

        callback = await client.get(
            "/auth/web/google/callback",
            params={"code": "google-code", "state": oauth_state},
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
        assert token.json()["user"]["email"] == "google-id-token@example.com"

    @pytest.mark.asyncio
    async def test_web_google_callback_falls_back_to_userinfo_when_id_token_fails(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        verifier, challenge = _make_pkce_pair()
        monkeypatch.setattr(settings, "google_oauth_client_id", "google-client-id")
        monkeypatch.setattr(settings, "google_oauth_client_secret", "google-client-secret")

        async def fake_get_authorization_url(
            redirect_uri: str,
            state: str | None = None,
            scope: list[str] | None = None,
            code_challenge: str | None = None,
            code_challenge_method: str | None = None,
            extras_params: dict[str, str] | None = None,
        ) -> str:
            assert redirect_uri.endswith("/auth/web/google/callback")
            assert scope == ["openid", "email", "profile"]
            assert code_challenge is None
            assert code_challenge_method is None
            assert state is not None
            return (
                "https://accounts.google.com/o/oauth2/v2/auth"
                f"?state={state}&redirect_uri={redirect_uri}"
            )

        async def fake_get_access_token(code: str, redirect_uri: str) -> dict[str, object]:
            assert code == "google-code"
            assert redirect_uri.endswith("/auth/web/google/callback")
            return {
                "access_token": "google-access-token",
                "id_token": "google-id-token",
                "scope": "openid email profile",
            }

        async def fake_get_id_email(_token: str) -> tuple[str, str]:
            raise AssertionError("Google legacy profile endpoint should not be used.")

        async def fake_decode_google_id_token(_id_token: str) -> dict[str, object]:
            raise identity_providers.HTTPException(
                status_code=400,
                detail="Google identity token could not be verified.",
            )

        async def fake_fetch_google_userinfo(access_token: str) -> dict[str, object]:
            assert access_token == "google-access-token"
            return {
                "sub": "google-subject-from-userinfo",
                "email": "google-userinfo@example.com",
                "email_verified": True,
                "name": "Google Userinfo",
                "picture": "https://example.com/userinfo-avatar.png",
            }

        monkeypatch.setattr(
            google_oauth_client,
            "get_authorization_url",
            fake_get_authorization_url,
        )
        monkeypatch.setattr(google_oauth_client, "get_access_token", fake_get_access_token)
        monkeypatch.setattr(google_oauth_client, "get_id_email", fake_get_id_email)
        monkeypatch.setattr(
            identity_providers,
            "_decode_google_id_token",
            fake_decode_google_id_token,
        )
        monkeypatch.setattr(
            identity_providers,
            "_fetch_google_userinfo",
            fake_fetch_google_userinfo,
        )

        started = await client.post(
            "/auth/web/google/start",
            json={
                "purpose": "login",
                "clientState": "google-userinfo-client-state",
                "codeChallenge": challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "http://localhost:5174/auth/callback",
            },
        )
        assert started.status_code == 200
        oauth_state = parse_qs(urlparse(started.json()["authorizationUrl"]).query)["state"][0]

        callback = await client.get(
            "/auth/web/google/callback",
            params={"code": "google-code", "state": oauth_state},
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
        assert token.json()["user"]["email"] == "google-userinfo@example.com"

    @pytest.mark.asyncio
    async def test_desktop_google_link_uses_desktop_redirect(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        user_id = await _create_user_via_manager("desktop-google-link@example.com")
        verifier, challenge = _make_pkce_pair()
        self._enable_google(
            monkeypatch,
            "desktop-google-link@example.com",
            expected_surface="desktop",
        )

        code = await _create_desktop_auth_code_for_user(
            user_id=user_id,
            state="desktop-google-existing-session",
            code_challenge=challenge,
        )
        session = await client.post(
            "/auth/desktop/token",
            json={
                "code": code,
                "code_verifier": verifier,
                "grant_type": "authorization_code",
            },
        )
        assert session.status_code == 200

        link_verifier, link_challenge = _make_pkce_pair()
        started = await client.post(
            "/auth/desktop/google/start",
            headers={"Authorization": f"Bearer {session.json()['access_token']}"},
            json={
                "purpose": "link",
                "clientState": "desktop-google-client-state",
                "codeChallenge": link_challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "proliferate://auth/callback",
            },
        )
        assert started.status_code == 200
        oauth_state = parse_qs(urlparse(started.json()["authorizationUrl"]).query)["state"][0]

        callback = await client.get(
            "/auth/desktop/google/callback",
            params={"code": "google-code", "state": oauth_state},
            follow_redirects=False,
        )
        assert callback.status_code == 302
        callback_url = urlparse(callback.headers["location"])
        assert callback_url.scheme == "proliferate"
        callback_query = parse_qs(callback_url.query)
        assert callback_query["state"] == ["desktop-google-client-state"]

        linked_session = await client.post(
            "/auth/desktop/token",
            json={
                "code": callback_query["code"][0],
                "code_verifier": link_verifier,
                "grant_type": "authorization_code",
            },
        )
        assert linked_session.status_code == 200
        assert linked_session.json()["user"]["email"] == "desktop-google-link@example.com"

    @pytest.mark.asyncio
    async def test_mobile_start_rejects_unregistered_redirect_uri(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _, challenge = _make_pkce_pair()
        self._enable_identity_github(monkeypatch, "mobile-redirect@example.com")

        started = await client.post(
            "/auth/mobile/github/start",
            json={
                "purpose": "login",
                "clientState": "mobile-client-state",
                "codeChallenge": challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "proliferate://other/callback",
            },
        )

        assert started.status_code == 400
        assert started.json()["detail"] == "Mobile redirect URI is not allowed."

    @pytest.mark.asyncio
    async def test_mobile_provider_error_redirects_to_app_callback(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _, challenge = _make_pkce_pair()
        self._enable_identity_github(monkeypatch, "mobile-error@example.com")

        started = await client.post(
            "/auth/mobile/github/start",
            json={
                "purpose": "login",
                "clientState": "mobile-client-state",
                "codeChallenge": challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "proliferate://auth/callback",
            },
        )
        assert started.status_code == 200
        oauth_state = parse_qs(urlparse(started.json()["authorizationUrl"]).query)["state"][0]

        callback = await client.get(
            "/auth/github/callback",
            params={"error": "access_denied", "state": oauth_state},
            follow_redirects=False,
        )

        assert callback.status_code == 302
        parsed = urlparse(callback.headers["location"])
        assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == "proliferate://auth/callback"
        callback_query = parse_qs(parsed.query)
        assert callback_query["error"] == ["access_denied"]
        assert callback_query["state"] == ["mobile-client-state"]

    @pytest.mark.asyncio
    async def test_required_github_link_route_is_registered_before_generic_start_route(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        user_id = await _create_user_via_manager("direct-github-link@example.com")
        verifier, challenge = _make_pkce_pair()
        self._enable_identity_github(monkeypatch, "direct-github-link@example.com")

        code = await _create_desktop_auth_code_for_user(
            user_id=user_id,
            state="direct-link-state",
            code_challenge=challenge,
        )
        token = await client.post(
            "/auth/desktop/token",
            json={
                "code": code,
                "code_verifier": verifier,
                "grant_type": "authorization_code",
            },
        )

        link_start = await client.post(
            "/auth/github/link/start",
            headers={"Authorization": f"Bearer {token.json()['access_token']}"},
            json={
                "purpose": "required_github_link",
                "clientState": "github-link-state",
                "codeChallenge": challenge,
                "codeChallengeMethod": "S256",
                "redirectUri": "http://localhost:5174/auth/callback",
            },
        )

        assert link_start.status_code == 200
        assert link_start.json()["provider"] == "github"


class TestRefreshToken:
    @pytest.mark.asyncio
    async def test_refresh_flow(self, client: AsyncClient) -> None:
        """Get tokens via PKCE, then refresh them."""
        user_id = await _create_user_via_manager("refresh@example.com")

        # Get tokens via PKCE
        verifier, challenge = _make_pkce_pair()
        code = await _create_desktop_auth_code_for_user(
            user_id=user_id,
            state="refresh-state",
            code_challenge=challenge,
        )

        resp = await client.post(
            "/auth/desktop/token",
            json={
                "code": code,
                "code_verifier": verifier,
                "grant_type": "authorization_code",
            },
        )
        original_tokens = resp.json()

        # Refresh
        resp = await client.post(
            "/auth/desktop/refresh",
            json={
                "refresh_token": original_tokens["refresh_token"],
                "grant_type": "refresh_token",
            },
        )
        assert resp.status_code == 200
        new_tokens = resp.json()
        assert "access_token" in new_tokens
        assert "refresh_token" in new_tokens
        assert len(new_tokens["access_token"]) > 0
        assert len(new_tokens["refresh_token"]) > 0

    @pytest.mark.asyncio
    async def test_invalid_refresh_token(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/auth/desktop/refresh",
            json={
                "refresh_token": "bogus-token",
                "grant_type": "refresh_token",
            },
        )
        assert resp.status_code == 401
