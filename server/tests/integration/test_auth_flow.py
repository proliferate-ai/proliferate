"""Integration tests for the auth flow: GitHub OAuth → desktop PKCE exchange."""

import base64
import hashlib
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import AsyncClient

from proliferate.auth.desktop import service as desktop_service
from proliferate.auth.oauth import github_oauth_client
from proliferate.config import settings
from proliferate.constants.auth import DESKTOP_GITHUB_CSRF_COOKIE
from proliferate.integrations.github import GitHubUserProfile


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
) -> str:
    """Create an active test user directly in the current test database."""
    from proliferate.db import engine as engine_module
    from proliferate.db.models.auth import User

    async with engine_module.async_session_factory() as session:
        user = User(
            email=email,
            hashed_password="unused-oauth-only",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name=display_name or "Desktop Tester",
        )
        session.add(user)
        await session.commit()
        return str(user.id)

    raise RuntimeError("Could not create test user")


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
        resp = await client.post(
            "/auth/desktop/authorize",
            params={"user_id": user_id},
            json={
                "state": "random-state-string",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "redirect_uri": "proliferate://auth/callback",
            },
        )
        assert resp.status_code == 201
        auth_data = resp.json()
        assert "code" in auth_data
        assert auth_data["state"] == "random-state-string"

        # Step 2: Desktop exchanges code + verifier for JWT
        resp = await client.post(
            "/auth/desktop/token",
            json={
                "code": auth_data["code"],
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

        # Step 3: Use the access token
        resp = await client.get(
            "/v1/cloud/workspaces",
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
        )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_pkce_wrong_verifier(self, client: AsyncClient) -> None:
        user_id = await _create_user_via_manager("pkce-wrong@example.com")
        _, challenge = _make_pkce_pair()

        resp = await client.post(
            "/auth/desktop/authorize",
            params={"user_id": user_id},
            json={
                "state": "state-1",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "redirect_uri": "proliferate://auth/callback",
            },
        )
        code = resp.json()["code"]

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

        resp = await client.post(
            "/auth/desktop/authorize",
            params={"user_id": user_id},
            json={
                "state": "state-2",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "redirect_uri": "proliferate://auth/callback",
            },
        )
        code = resp.json()["code"]

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
        resp = await client.post(
            "/auth/desktop/authorize",
            params={"user_id": user_id},
            json={
                "state": "state-3",
                "code_challenge": "whatever",
                "code_challenge_method": "plain",
                "redirect_uri": "proliferate://auth/callback",
            },
        )
        assert resp.status_code == 400


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
            return {"access_token": "github-access-token", "expires_at": 3600}

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


class TestRefreshToken:
    @pytest.mark.asyncio
    async def test_refresh_flow(self, client: AsyncClient) -> None:
        """Get tokens via PKCE, then refresh them."""
        user_id = await _create_user_via_manager("refresh@example.com")

        # Get tokens via PKCE
        verifier, challenge = _make_pkce_pair()
        resp = await client.post(
            "/auth/desktop/authorize",
            params={"user_id": user_id},
            json={
                "state": "refresh-state",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "redirect_uri": "proliferate://auth/callback",
            },
        )
        code = resp.json()["code"]

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
