from __future__ import annotations

import uuid
from typing import cast

import httpx
import pytest
from fastapi import Request
from httpx_oauth.exceptions import GetIdEmailError, GetProfileError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity import providers, service
from proliferate.auth.identity.types import AuthChallengeSnapshot
from proliferate.auth.oauth import github_oauth_client


def _provider_response(status_code: int) -> httpx.Response:
    return httpx.Response(
        status_code,
        request=httpx.Request("GET", "https://api.github.test/user"),
    )


def _challenge() -> AuthChallengeSnapshot:
    return AuthChallengeSnapshot(
        id=uuid.uuid4(),
        provider="github",
        surface="desktop",
        purpose="login",
        user_id=None,
        client_state="desktop-state",
        code_challenge="challenge",
        code_challenge_method="S256",
        redirect_uri="proliferate://auth/callback",
        nonce_hash="nonce-hash",
    )


def _install_github_profile_failure(
    monkeypatch: pytest.MonkeyPatch,
    *,
    status_code: int,
) -> None:
    async def get_access_token(code: str, redirect_uri: str) -> dict[str, str]:
        assert code == "github-code"
        assert redirect_uri == "https://api.example.test/auth/github/callback"
        return {"access_token": "unusable-token"}

    async def get_id_email(access_token: str) -> tuple[str, str]:
        assert access_token == "unusable-token"
        raise GetIdEmailError(response=_provider_response(status_code))

    async def get_profile(access_token: str) -> dict[str, object]:
        assert access_token == "unusable-token"
        raise GetProfileError(response=_provider_response(status_code))

    monkeypatch.setattr(github_oauth_client, "get_access_token", get_access_token)
    monkeypatch.setattr(github_oauth_client, "get_id_email", get_id_email)
    monkeypatch.setattr(github_oauth_client, "get_profile", get_profile)


@pytest.mark.asyncio  # type: ignore[untyped-decorator]
async def test_github_profile_401_returns_to_originating_surface(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    challenge = _challenge()

    async def consume_challenge(
        _db: object,
        *,
        state: str,
        provider: str,
        surface: str | None,
    ) -> AuthChallengeSnapshot:
        assert state == "oauth-state"
        assert provider == "github"
        assert surface is None
        return challenge

    monkeypatch.setattr(service, "_consume_challenge_for_callback", consume_challenge)
    monkeypatch.setattr(
        providers,
        "provider_callback_url",
        lambda _request, *, provider, surface: "https://api.example.test/auth/github/callback",
    )
    _install_github_profile_failure(monkeypatch, status_code=401)

    redirect_url = await service.complete_oauth_provider_callback(
        cast(AsyncSession, object()),
        cast(Request, object()),
        provider="github",
        surface=None,
        state="oauth-state",
        code="github-code",
    )

    assert redirect_url == ("proliferate://auth/callback?error=provider_error&state=desktop-state")


@pytest.mark.asyncio  # type: ignore[untyped-decorator]
async def test_github_profile_5xx_remains_reportable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_github_profile_failure(monkeypatch, status_code=503)

    with pytest.raises(GetProfileError) as caught:
        await providers.verify_oauth_callback(
            provider="github",
            surface="desktop",
            code="github-code",
            provider_callback_url="https://api.example.test/auth/github/callback",
        )

    assert caught.value.response is not None
    assert caught.value.response.status_code == 503
