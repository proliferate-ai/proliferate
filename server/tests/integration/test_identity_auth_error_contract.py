from __future__ import annotations

import logging
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from fastapi_users.jwt import generate_jwt
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity import providers, service
from proliferate.auth.identity.password import hash_password_login_bucket
from proliferate.auth.identity.types import VerifiedProviderIdentity
from proliferate.auth.oauth import google_oauth_client
from proliferate.auth.passwords import hash_password
from proliferate.auth.tokens import REFRESH_TOKEN_AUDIENCE
from proliferate.config import settings
from proliferate.constants.auth import (
    PASSWORD_LOGIN_EMAIL_BUCKET,
    PASSWORD_LOGIN_FAILURE_LIMIT,
    REFRESH_TOKEN_LIFETIME_SECONDS,
)
from proliferate.db.models.auth import AuthChallenge, PasswordLoginAttempt, User
from tests.helpers.desktop_auth import create_desktop_auth_code, make_pkce_pair


def _assert_error(response: Response, *, status_code: int, detail: str) -> None:
    assert response.status_code == status_code
    assert response.json() == {"detail": detail}
    assert "retry-after" not in response.headers
    assert "www-authenticate" not in response.headers


def _start_body(*, redirect_uri: str | None = None) -> dict[str, str]:
    return {
        "purpose": "login",
        "clientState": "client-state",
        "codeChallenge": "pkce-challenge",
        "codeChallengeMethod": "S256",
        "redirectUri": redirect_uri or settings.mobile_redirect_uri,
    }


async def _create_user(
    db: AsyncSession,
    *,
    email: str,
    password: str | None = None,
    is_active: bool = True,
    token_generation: int = 0,
) -> User:
    user = User(
        email=email,
        hashed_password=hash_password(password) if password else "unused-oauth-only",
        password_set_at=datetime.now(UTC) if password else None,
        is_active=is_active,
        is_superuser=False,
        is_verified=True,
        token_generation=token_generation,
    )
    db.add(user)
    await db.commit()
    return user


async def _start_google(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> str:
    monkeypatch.setattr(settings, "google_oauth_client_id", "google-client")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "google-secret")
    monkeypatch.setattr(
        google_oauth_client,
        "get_authorization_url",
        AsyncMock(return_value="https://accounts.example.test/authorize"),
    )
    response = await client.post("/auth/mobile/google/start", json=_start_body())
    assert response.status_code == 200
    state = response.json()["state"]
    assert isinstance(state, str)
    return state


def _refresh_token(**claims: object) -> str:
    return generate_jwt(
        data={"aud": REFRESH_TOKEN_AUDIENCE, **claims},
        secret=settings.jwt_secret,
        lifetime_seconds=REFRESH_TOKEN_LIFETIME_SECONDS,
    )


async def _refresh(client: AsyncClient, token: str) -> Response:
    return await client.post(
        "/auth/mobile/session/refresh",
        json={"refreshToken": token, "grantType": "refresh_token"},
    )


@pytest.mark.asyncio
async def test_password_disabled_preserves_404_contract(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "password_auth_enabled", False)

    response = await client.post(
        "/auth/mobile/password/login",
        json={"email": "disabled@example.com", "password": "irrelevant password"},
    )

    _assert_error(
        response,
        status_code=404,
        detail="Email sign-in is not enabled.",
    )


@pytest.mark.asyncio
async def test_provider_not_configured_preserves_503_contract(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "google_oauth_client_id", "")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "")

    response = await client.post("/auth/mobile/google/start", json=_start_body())

    _assert_error(
        response,
        status_code=503,
        detail="google sign-in is not configured.",
    )


@pytest.mark.asyncio
async def test_mobile_redirect_rejection_preserves_400_contract(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "google_oauth_client_id", "google-client")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "google-secret")

    response = await client.post(
        "/auth/mobile/google/start",
        json=_start_body(redirect_uri="wrong://auth/callback"),
    )

    _assert_error(
        response,
        status_code=400,
        detail="Mobile redirect URI is not allowed.",
    )


@pytest.mark.asyncio
async def test_password_failures_commit_counters_and_rate_limit_without_header(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "password_auth_enabled", True)
    email = "rate-limit@example.com"
    await _create_user(db_session, email=email, password="correct horse battery staple")

    for _ in range(PASSWORD_LOGIN_FAILURE_LIMIT):
        response = await client.post(
            "/auth/mobile/password/login",
            json={"email": email, "password": "wrong horse battery staple"},
        )
        _assert_error(
            response,
            status_code=401,
            detail="Email or password is incorrect.",
        )

    bucket_key = hash_password_login_bucket(PASSWORD_LOGIN_EMAIL_BUCKET, email)
    result = await db_session.execute(
        select(PasswordLoginAttempt).where(
            PasswordLoginAttempt.bucket_kind == PASSWORD_LOGIN_EMAIL_BUCKET,
            PasswordLoginAttempt.bucket_key == bucket_key,
        )
    )
    attempt = result.scalar_one()
    assert attempt.failure_count == PASSWORD_LOGIN_FAILURE_LIMIT
    assert attempt.blocked_until is not None

    response = await client.post(
        "/auth/mobile/password/login",
        json={"email": email, "password": "wrong horse battery staple"},
    )
    _assert_error(
        response,
        status_code=429,
        detail="Too many attempts. Wait a moment, then try again.",
    )


@pytest.mark.asyncio
async def test_invalid_and_consumed_auth_state_preserve_400_contract(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invalid = await client.post(
        "/auth/mobile/apple/complete",
        json={"state": "missing-state", "identityToken": "apple-token"},
    )
    _assert_error(
        invalid,
        status_code=400,
        detail="Invalid or expired auth state.",
    )

    state = await _start_google(client, monkeypatch)
    result = await db_session.execute(
        select(AuthChallenge).where(AuthChallenge.state_hash == service.hash_secret(state))
    )
    challenge = result.scalar_one()
    challenge.consumed_at = datetime.now(UTC)
    await db_session.commit()

    consumed = await client.get(
        "/auth/mobile/google/callback",
        params={"state": state, "code": "google-code"},
    )
    _assert_error(
        consumed,
        status_code=400,
        detail="Invalid or expired auth state.",
    )


@pytest.mark.asyncio
async def test_auth_code_and_pkce_failures_preserve_details_and_rollback(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    invalid = await client.post(
        "/auth/mobile/token",
        json={
            "code": "missing-code",
            "codeVerifier": "missing-verifier",
            "grantType": "authorization_code",
        },
    )
    _assert_error(
        invalid,
        status_code=400,
        detail="Invalid, expired, or consumed auth code.",
    )

    user = await _create_user(db_session, email="pkce@example.com")
    verifier, challenge = make_pkce_pair()
    code = await create_desktop_auth_code(
        user_id=user.id,
        state="pkce-state",
        code_challenge=challenge,
    )
    rejected = await client.post(
        "/auth/mobile/token",
        json={
            "code": code,
            "codeVerifier": "wrong-verifier",
            "grantType": "authorization_code",
        },
    )
    _assert_error(
        rejected,
        status_code=400,
        detail="PKCE verification failed.",
    )

    retried = await client.post(
        "/auth/mobile/token",
        json={
            "code": code,
            "codeVerifier": verifier,
            "grantType": "authorization_code",
        },
    )
    assert retried.status_code == 200


@pytest.mark.asyncio
async def test_refresh_decode_and_payload_failures_preserve_401_contract(
    client: AsyncClient,
) -> None:
    decoded = await _refresh(client, "not-a-refresh-token")
    _assert_error(
        decoded,
        status_code=401,
        detail="Invalid or expired refresh token.",
    )

    payload = await _refresh(client, _refresh_token())
    _assert_error(
        payload,
        status_code=401,
        detail="Invalid refresh token payload.",
    )


@pytest.mark.asyncio
async def test_revoked_refresh_generation_preserves_401_contract(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user = await _create_user(
        db_session,
        email="revoked@example.com",
        token_generation=2,
    )

    response = await _refresh(
        client,
        _refresh_token(sub=str(user.id), token_generation=1),
    )

    _assert_error(
        response,
        status_code=401,
        detail="Refresh token has been revoked.",
    )


@pytest.mark.asyncio
async def test_inactive_user_preserves_403_contract(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user = await _create_user(
        db_session,
        email="inactive@example.com",
        is_active=False,
    )

    response = await _refresh(
        client,
        _refresh_token(sub=str(user.id), token_generation=0),
    )

    _assert_error(response, status_code=403, detail="User is inactive.")


@pytest.mark.asyncio
async def test_provider_verification_failure_is_raw_and_rolls_back_state(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = await _start_google(client, monkeypatch)
    source_error = providers.ProviderVerificationError(
        "identity_google_email_missing",
        "Google did not return an email address.",
    )
    monkeypatch.setattr(
        providers,
        "verify_oauth_callback",
        AsyncMock(side_effect=source_error),
    )

    response = await client.get(
        "/auth/mobile/google/callback",
        params={"state": state, "code": "google-code"},
    )

    _assert_error(
        response,
        status_code=400,
        detail="Google did not return an email address.",
    )
    assert source_error.code not in response.text
    result = await db_session.execute(
        select(AuthChallenge).where(AuthChallenge.state_hash == service.hash_secret(state))
    )
    assert result.scalar_one().consumed_at is None


@pytest.mark.asyncio
async def test_provider_email_conflict_preserves_409_contract(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = "existing@example.com"
    await _create_user(db_session, email=email)
    state = await _start_google(client, monkeypatch)
    monkeypatch.setattr(
        providers,
        "verify_oauth_callback",
        AsyncMock(
            return_value=VerifiedProviderIdentity(
                provider="google",
                provider_subject="new-google-subject",
                email=email,
                email_verified=True,
                display_name=None,
                provider_login=None,
                avatar_url=None,
                access_token="google-token",
                refresh_token=None,
                expires_at=None,
                expires_at_timestamp=None,
                scopes=frozenset(),
            )
        ),
    )

    response = await client.get(
        "/auth/mobile/google/callback",
        params={"state": state, "code": "google-code"},
    )

    _assert_error(
        response,
        status_code=409,
        detail="An account already exists for this email. Sign in with GitHub to link it.",
    )


@pytest.mark.asyncio
async def test_mobile_token_logs_sign_in_outcome(
    client: AsyncClient,
    db_session: AsyncSession,
    sign_in_log_records: list[logging.LogRecord],
) -> None:
    """The sign-in success-rate SLI depends on this log line existing.

    See `server/proliferate/auth/sign_in_observability.py` and
    `guides/operating/production-alerts.md#sign-in-success-rate`.
    """
    failed = await client.post(
        "/auth/mobile/token",
        json={
            "code": "missing-code",
            "codeVerifier": "missing-verifier",
            "grantType": "authorization_code",
        },
    )
    assert failed.status_code == 400

    user = await _create_user(db_session, email="sli-mobile@example.com")
    verifier, challenge = make_pkce_pair()
    code = await create_desktop_auth_code(
        user_id=user.id,
        state="sli-mobile-state",
        code_challenge=challenge,
    )
    succeeded = await client.post(
        "/auth/mobile/token",
        json={
            "code": code,
            "codeVerifier": verifier,
            "grantType": "authorization_code",
        },
    )
    assert succeeded.status_code == 200

    records = sign_in_log_records
    assert len(records) == 2
    failure_record, success_record = records
    assert failure_record.event == "auth.sign_in.outcome"
    assert failure_record.auth_sign_in_outcome == "failure"
    assert failure_record.auth_sign_in_surface == "mobile"
    assert failure_record.auth_sign_in_failure_code == "identity_auth_code_invalid"
    assert success_record.auth_sign_in_outcome == "success"
    assert success_record.auth_sign_in_surface == "mobile"
    assert not hasattr(success_record, "auth_sign_in_failure_code")


@pytest.mark.asyncio
async def test_web_token_logs_sign_in_outcome(
    client: AsyncClient,
    db_session: AsyncSession,
    sign_in_log_records: list[logging.LogRecord],
) -> None:
    failed = await client.post(
        "/auth/web/token",
        json={
            "code": "missing-code",
            "codeVerifier": "missing-verifier",
            "grantType": "authorization_code",
        },
    )
    assert failed.status_code == 400

    records = sign_in_log_records
    assert len(records) == 1
    record = records[0]
    assert record.auth_sign_in_outcome == "failure"
    assert record.auth_sign_in_surface == "web"
    assert record.auth_sign_in_failure_code == "identity_auth_code_invalid"
