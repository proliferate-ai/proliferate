from __future__ import annotations

import logging
from uuid import uuid4

import pytest
from fastapi_users.jwt import generate_jwt
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.tokens import REFRESH_TOKEN_AUDIENCE
from proliferate.config import settings
from proliferate.constants.auth import REFRESH_TOKEN_LIFETIME_SECONDS
from proliferate.db.models.auth import User
from tests.helpers.desktop_auth import mint_desktop_token_payload


def _signed_refresh_token(claims: dict[str, object]) -> str:
    return generate_jwt(
        data={"aud": REFRESH_TOKEN_AUDIENCE, **claims},
        secret=settings.jwt_secret,
        lifetime_seconds=REFRESH_TOKEN_LIFETIME_SECONDS,
    )


def _assert_desktop_error(response: Response, *, status_code: int, detail: str) -> None:
    assert response.status_code == status_code
    assert response.json() == {"detail": detail}
    assert "www-authenticate" not in response.headers
    assert "retry-after" not in response.headers


async def _create_active_user(
    db_session: AsyncSession,
    *,
    token_generation: int = 0,
) -> User:
    user = User(
        email=f"desktop-error-{uuid4().hex}@proliferate.dev",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        token_generation=token_generation,
    )
    db_session.add(user)
    await db_session.commit()
    return user


@pytest.mark.asyncio
async def test_invalid_poll_verifier_keeps_raw_detail(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/desktop/poll",
        json={"state": "desktop-error-state", "code_verifier": "not-ascii-☃"},
    )

    _assert_desktop_error(response, status_code=400, detail="Invalid code_verifier")


@pytest.mark.asyncio
async def test_wrong_authorization_grant_keeps_raw_detail(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/desktop/token",
        json={
            "code": "unused-code",
            "code_verifier": "unused-verifier",
            "grant_type": "refresh_token",
        },
    )

    _assert_desktop_error(
        response,
        status_code=400,
        detail="grant_type must be 'authorization_code'",
    )


@pytest.mark.asyncio
async def test_absent_authorization_code_keeps_raw_detail(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/desktop/token",
        json={
            "code": "missing-code",
            "code_verifier": "unused-verifier",
            "grant_type": "authorization_code",
        },
    )

    _assert_desktop_error(
        response,
        status_code=400,
        detail="Invalid, expired, or already-consumed authorization code",
    )


@pytest.mark.asyncio
async def test_wrong_refresh_grant_keeps_raw_detail(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/desktop/refresh",
        json={"refresh_token": "unused-token", "grant_type": "authorization_code"},
    )

    _assert_desktop_error(
        response,
        status_code=400,
        detail="grant_type must be 'refresh_token'",
    )


@pytest.mark.asyncio
async def test_malformed_refresh_token_keeps_raw_detail(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/desktop/refresh",
        json={"refresh_token": "not-a-token", "grant_type": "refresh_token"},
    )

    _assert_desktop_error(
        response,
        status_code=401,
        detail="Invalid or expired refresh token",
    )


@pytest.mark.parametrize(
    "claims",
    [{}, {"sub": "not-a-uuid"}],
    ids=["missing-subject", "malformed-subject"],
)
@pytest.mark.asyncio
async def test_invalid_refresh_payload_keeps_raw_detail(
    client: AsyncClient,
    claims: dict[str, object],
) -> None:
    response = await client.post(
        "/auth/desktop/refresh",
        json={
            "refresh_token": _signed_refresh_token(claims),
            "grant_type": "refresh_token",
        },
    )

    _assert_desktop_error(
        response,
        status_code=401,
        detail="Invalid refresh token payload",
    )


@pytest.mark.asyncio
async def test_stale_refresh_generation_keeps_raw_detail(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user = await _create_active_user(db_session, token_generation=2)
    refresh_token = _signed_refresh_token({"sub": str(user.id), "token_generation": 1})

    response = await client.post(
        "/auth/desktop/refresh",
        json={"refresh_token": refresh_token, "grant_type": "refresh_token"},
    )

    _assert_desktop_error(
        response,
        status_code=401,
        detail="Refresh token has been revoked",
    )


@pytest.mark.asyncio
async def test_token_exchange_logs_sign_in_failure_outcome(
    client: AsyncClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The sign-in success-rate SLI depends on this log line existing.

    See `server/proliferate/auth/sign_in_observability.py` and
    `guides/operating/production-alerts.md#sign-in-success-rate`.
    """
    caplog.set_level(logging.INFO, logger="proliferate.auth.sign_in")

    response = await client.post(
        "/auth/desktop/token",
        json={
            "code": "missing-code",
            "code_verifier": "unused-verifier",
            "grant_type": "authorization_code",
        },
    )

    assert response.status_code == 400
    records = [r for r in caplog.records if r.name == "proliferate.auth.sign_in"]
    assert len(records) == 1
    record = records[0]
    assert record.event == "auth.sign_in.outcome"
    assert record.auth_sign_in_outcome == "failure"
    assert record.auth_sign_in_surface == "desktop"
    assert record.auth_sign_in_failure_code == "desktop_auth_code_invalid"


@pytest.mark.asyncio
async def test_token_exchange_logs_sign_in_success_outcome(
    client: AsyncClient,
    db_session: AsyncSession,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="proliferate.auth.sign_in")
    user = await _create_active_user(db_session)

    payload = await mint_desktop_token_payload(
        client,
        user_id=user.id,
        state_prefix="sli-success",
    )

    assert "access_token" in payload
    records = [r for r in caplog.records if r.name == "proliferate.auth.sign_in"]
    assert len(records) == 1
    record = records[0]
    assert record.event == "auth.sign_in.outcome"
    assert record.auth_sign_in_outcome == "success"
    assert record.auth_sign_in_surface == "desktop"
    assert not hasattr(record, "auth_sign_in_failure_code")
