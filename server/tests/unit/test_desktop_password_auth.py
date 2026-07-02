"""Tests for desktop password sign-in and the auth-methods probe."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.auth.identity.store import create_auth_user
from proliferate.auth.passwords import hash_password
from proliferate.config import settings
from proliferate.db.store.auth_passwords import update_user_password_hash

# A real-shaped domain: the /users/me response model validates emails strictly
# and rejects reserved TLDs like .test.
USER_EMAIL = "person@example.com"
PASSWORD = "a-strong-enough-password"
LOGIN_PATH = "/auth/desktop/password/login"
METHODS_PATH = "/auth/desktop/methods"


async def _create_password_user(test_engine, *, email=USER_EMAIL, password=PASSWORD):
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as session:
        user = await create_auth_user(session, email=email, display_name=None, avatar_url=None)
        await update_user_password_hash(
            session,
            user_id=user.id,
            hashed_password=hash_password(password),
            password_set_at=datetime.now(UTC),
        )
        await session.commit()
        return user


# ---------------------------------------------------------------------------
# Desktop password login
# ---------------------------------------------------------------------------


async def test_desktop_password_login_issues_working_session(client, test_engine):
    user = await _create_password_user(test_engine)

    response = await client.post(LOGIN_PATH, json={"email": USER_EMAIL, "password": PASSWORD})
    assert response.status_code == 200
    payload = response.json()
    assert payload["token_type"] == "bearer"
    assert payload["expires_in"] > 0
    assert payload["user"]["id"] == str(user.id)
    assert payload["user"]["email"] == USER_EMAIL

    # The access token works against an authenticated endpoint.
    me = await client.get(
        "/users/me",
        headers={"Authorization": f"Bearer {payload['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json()["email"] == USER_EMAIL

    # The refresh token is the same desktop refresh shape the OAuth flow issues.
    refreshed = await client.post(
        "/auth/desktop/refresh",
        json={"refresh_token": payload["refresh_token"], "grant_type": "refresh_token"},
    )
    assert refreshed.status_code == 200
    assert refreshed.json()["user"]["email"] == USER_EMAIL


async def test_desktop_password_login_rejects_wrong_password(client, test_engine):
    await _create_password_user(test_engine)

    response = await client.post(
        LOGIN_PATH,
        json={"email": USER_EMAIL, "password": "not-the-password"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Email or password is incorrect."


async def test_desktop_password_login_rejects_oauth_only_user(client, test_engine):
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as session:
        await create_auth_user(session, email=USER_EMAIL, display_name=None, avatar_url=None)
        await session.commit()

    response = await client.post(LOGIN_PATH, json={"email": USER_EMAIL, "password": PASSWORD})
    assert response.status_code == 401


async def test_desktop_password_login_respects_kill_switch(client, test_engine, monkeypatch):
    await _create_password_user(test_engine)
    monkeypatch.setattr(settings, "password_auth_enabled", False)

    response = await client.post(LOGIN_PATH, json={"email": USER_EMAIL, "password": PASSWORD})
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Auth-methods probe
# ---------------------------------------------------------------------------


async def test_auth_methods_probe_reports_password_only_without_github(client, monkeypatch):
    monkeypatch.setattr(settings, "github_oauth_client_id", "")
    monkeypatch.setattr(settings, "github_oauth_client_secret", "")

    response = await client.get(METHODS_PATH)
    assert response.status_code == 200
    assert response.json() == {"password_login": True, "github": False}


async def test_auth_methods_probe_reports_github_when_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "github_oauth_client_id", "client-id")
    monkeypatch.setattr(settings, "github_oauth_client_secret", "client-secret")

    response = await client.get(METHODS_PATH)
    assert response.status_code == 200
    assert response.json() == {"password_login": True, "github": True}


async def test_auth_methods_probe_respects_password_kill_switch(client, monkeypatch):
    monkeypatch.setattr(settings, "password_auth_enabled", False)
    monkeypatch.setattr(settings, "github_oauth_client_id", "")
    monkeypatch.setattr(settings, "github_oauth_client_secret", "")

    response = await client.get(METHODS_PATH)
    assert response.status_code == 200
    assert response.json() == {"password_login": False, "github": False}
