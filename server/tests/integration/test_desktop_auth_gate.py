"""Tests that validate the desktop auth gate after the app has a session.

These tests focus on protected-route behavior once the desktop has obtained a
valid bearer token. Browser redirect wiring is covered separately.
"""

import base64
import hashlib
import uuid

import pytest
from httpx import AsyncClient

PROTECTED_ENDPOINTS = [
    ("GET", "/v1/cloud/workspaces"),
    ("GET", "/v1/billing/plan"),
    ("GET", "/v1/billing/cloud-plan"),
    ("GET", "/users/me"),
]


async def _create_user_and_get_tokens(client: AsyncClient, email: str | None = None) -> dict:
    """Create a user via the user manager and obtain tokens via PKCE."""
    if email is None:
        email = f"gate-{uuid.uuid4().hex[:8]}@proliferate.dev"

    from proliferate.db import engine as engine_module
    from proliferate.db.models.auth import User

    async with engine_module.async_session_factory() as session:
        user = User(
            email=email,
            hashed_password="unused-oauth-only",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name="Desktop Gate Tester",
        )
        session.add(user)
        await session.commit()
        user_id = str(user.id)

    verifier = "test-code-verifier-that-is-long-enough-for-pkce"
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    resp = await client.post(
        "/auth/desktop/authorize",
        params={"user_id": user_id},
        json={
            "state": f"gate-state-{uuid.uuid4().hex[:8]}",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "redirect_uri": "proliferate://auth/callback",
        },
    )
    assert resp.status_code == 201
    code = resp.json()["code"]

    resp = await client.post(
        "/auth/desktop/token",
        json={
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
        },
    )
    assert resp.status_code == 200
    return resp.json()


class TestDesktopAuthGate:
    """Validate protected endpoints once the desktop has authenticated."""

    @pytest.mark.asyncio
    async def test_authed_desktop_user_can_access_all_endpoints(self, client: AsyncClient) -> None:
        """A desktop user with a valid desktop token can hit every protected route."""
        tokens = await _create_user_and_get_tokens(client)
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        for method, path in PROTECTED_ENDPOINTS:
            resp = await client.request(method, path, headers=headers)
            assert resp.status_code == 200, (
                f"{method} {path} returned {resp.status_code} for authed user"
            )

    @pytest.mark.asyncio
    async def test_no_token_blocked_from_all_endpoints(self, client: AsyncClient) -> None:
        """A desktop app that never logged in gets 401 on every protected route."""
        for method, path in PROTECTED_ENDPOINTS:
            resp = await client.request(method, path)
            assert resp.status_code == 401, (
                f"{method} {path} returned {resp.status_code} without token"
            )

    @pytest.mark.asyncio
    async def test_garbage_token_blocked(self, client: AsyncClient) -> None:
        """A desktop app with a garbage token gets 401."""
        headers = {"Authorization": "Bearer this.is.not.a.real.jwt"}

        for method, path in PROTECTED_ENDPOINTS:
            resp = await client.request(method, path, headers=headers)
            assert resp.status_code == 401, (
                f"{method} {path} returned {resp.status_code} with garbage token"
            )

    @pytest.mark.asyncio
    async def test_expired_refresh_token_cannot_mint_new_access(self, client: AsyncClient) -> None:
        """A fake/expired refresh token cannot be used to get fresh access tokens."""
        resp = await client.post(
            "/auth/desktop/refresh",
            json={
                "refresh_token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.fake",
                "grant_type": "refresh_token",
            },
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_pkce_token_contains_user_info(self, client: AsyncClient) -> None:
        """The desktop token response includes user info the app needs."""
        email = f"info-{uuid.uuid4().hex[:8]}@proliferate.dev"
        tokens = await _create_user_and_get_tokens(client, email=email)

        assert "user" in tokens
        assert tokens["user"]["email"] == email
        assert "id" in tokens["user"]
        # display_name may be None, but the key must exist
        assert "display_name" in tokens["user"]

    @pytest.mark.asyncio
    async def test_desktop_user_info_endpoint(self, client: AsyncClient) -> None:
        """The /users/me endpoint returns current user info for the desktop app."""
        email = f"me-{uuid.uuid4().hex[:8]}@proliferate.dev"
        tokens = await _create_user_and_get_tokens(client, email=email)
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        resp = await client.get("/users/me", headers=headers)
        assert resp.status_code == 200
        user = resp.json()
        assert user["email"] == email
        assert user["is_active"] is True
