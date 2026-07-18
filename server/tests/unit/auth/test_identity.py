import uuid

import pytest
from httpx import Request, Response
from httpx_oauth.oauth2 import GetAccessTokenError

import proliferate.auth.identity.providers as providers
from proliferate.auth.identity import (
    onboarding_state_for_user,
    user_has_product_identity,
    user_has_provider,
)
from proliferate.auth.oauth import google_oauth_client
from proliferate.db.models.auth import OAuthAccount, User


def _user_with_accounts(*oauth_names: str) -> User:
    user = User(
        id=uuid.uuid4(),
        email="identity@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    user.oauth_accounts = [
        OAuthAccount(
            user_id=user.id,
            oauth_name=oauth_name,
            access_token=f"{oauth_name}-access-token",
            account_id=f"{oauth_name}-account-id",
            account_email=f"{oauth_name}@example.com",
        )
        for oauth_name in oauth_names
    ]
    return user


def test_google_only_user_is_limited_until_github_is_connected() -> None:
    user = _user_with_accounts("google")

    assert user_has_provider(user, "google") is True
    assert user_has_product_identity(user) is False
    assert onboarding_state_for_user(user) == "needs_github"


def test_github_link_is_product_identity() -> None:
    user = _user_with_accounts("google", "github")

    assert user_has_provider(user, "github") is True
    assert user_has_product_identity(user) is True
    assert onboarding_state_for_user(user) == "active"


@pytest.mark.asyncio
@pytest.mark.parametrize("status_code", [None, 503], ids=["transport", "provider-outage"])
async def test_google_non_rejection_token_failure_stays_a_server_failure(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int | None,
) -> None:
    response = (
        None
        if status_code is None
        else Response(
            status_code=status_code,
            request=Request("POST", "https://oauth2.googleapis.com/token"),
        )
    )
    error = GetAccessTokenError("Google token endpoint failed.", response)

    async def fail_access_token(_code: str, _redirect_uri: str) -> dict[str, object]:
        raise error

    monkeypatch.setattr(google_oauth_client, "get_access_token", fail_access_token)

    with pytest.raises(GetAccessTokenError) as exc_info:
        await providers.verify_oauth_callback(
            provider="google",
            surface="web",
            code="google-code",
            provider_callback_url="https://api.example.com/auth/web/google/callback",
        )

    assert exc_info.value is error


@pytest.mark.asyncio
async def test_apple_identity_ignores_unsigned_email_hint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_decode_apple_identity_token(
        *,
        identity_token: str,
        expected_nonce: str,
        surface: str,
    ) -> dict[str, object]:
        return {"sub": "apple-subject", "email_verified": "true"}

    monkeypatch.setattr(
        providers,
        "_decode_apple_identity_token",
        fake_decode_apple_identity_token,
    )

    verified = await providers.verify_apple_identity_token(
        identity_token="apple-token",
        expected_nonce="nonce",
        surface="mobile",
        email_hint="spoofed@example.com",
        display_name_hint="Apple Tester",
    )

    assert verified.email is None
    assert verified.email_verified is False
    assert verified.display_name == "Apple Tester"


@pytest.mark.asyncio
async def test_apple_identity_trusts_signed_email_claim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_decode_apple_identity_token(
        *,
        identity_token: str,
        expected_nonce: str,
        surface: str,
    ) -> dict[str, object]:
        return {
            "sub": "apple-subject",
            "email": "signed@example.com",
            "email_verified": "true",
        }

    monkeypatch.setattr(
        providers,
        "_decode_apple_identity_token",
        fake_decode_apple_identity_token,
    )

    verified = await providers.verify_apple_identity_token(
        identity_token="apple-token",
        expected_nonce="nonce",
        surface="mobile",
        email_hint="spoofed@example.com",
        display_name_hint=None,
    )

    assert verified.email == "signed@example.com"
    assert verified.email_verified is True
