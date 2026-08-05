from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import Request
from httpx_oauth.exceptions import GetIdEmailError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.errors import AuthFlowError
from proliferate.auth.identity import password, providers, service, sessions
from proliferate.auth.identity.types import (
    AuthChallengeSnapshot,
    AuthProviderName,
    VerifiedProviderIdentity,
)
from proliferate.auth.oauth import github_oauth_client, google_oauth_client
from proliferate.config import settings
from proliferate.errors import ProliferateError
from proliferate.integrations.github import GitHubIntegrationError
from proliferate.server.accounts.identity import service as accounts_service


def _assert_provider_error(
    exc_info: pytest.ExceptionInfo[providers.ProviderVerificationError],
    *,
    code: str,
    message: str,
) -> None:
    assert (exc_info.value.code, exc_info.value.message, str(exc_info.value)) == (
        code,
        message,
        message,
    )


def _assert_auth_error(
    exc_info: pytest.ExceptionInfo[AuthFlowError],
    *,
    code: str,
    status_code: int,
    message: str,
) -> None:
    assert (exc_info.value.code, exc_info.value.status_code, exc_info.value.message) == (
        code,
        status_code,
        message,
    )


def _provider_response(status_code: int = 400) -> httpx.Response:
    return httpx.Response(
        status_code,
        request=httpx.Request("GET", "https://provider.example.test/profile"),
    )


class _JsonResponse:
    def __init__(self, payload: object) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


def _install_json_response(monkeypatch: pytest.MonkeyPatch, payload: object) -> None:
    response = _JsonResponse(payload)

    class _Client:
        def __init__(self, *args: object, **kwargs: object) -> None:
            del args, kwargs

        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, *args: object) -> None:
            del args

        async def get(self, *args: object, **kwargs: object) -> _JsonResponse:
            del args, kwargs
            return response

    monkeypatch.setattr(providers.httpx, "AsyncClient", _Client)


def _verified_identity(
    *, provider: str = "google", email: str | None = None
) -> VerifiedProviderIdentity:
    return VerifiedProviderIdentity(
        provider=cast(AuthProviderName, provider),
        provider_subject="provider-subject",
        email=email,
        email_verified=email is not None,
        display_name=None,
        provider_login=None,
        avatar_url=None,
        access_token="provider-token",
        refresh_token=None,
        expires_at=None,
        expires_at_timestamp=None,
        scopes=frozenset(),
    )


def _challenge(*, provider: str = "google", surface: str = "web") -> AuthChallengeSnapshot:
    return AuthChallengeSnapshot(
        id=uuid4(),
        provider=cast(AuthProviderName, provider),
        surface=surface,
        purpose="login",
        user_id=None,
        client_state="client-state",
        code_challenge="challenge",
        code_challenge_method="S256",
        redirect_uri="https://client.example.test/callback",
        nonce_hash="nonce-hash",
    )


async def _verify_oauth(provider: AuthProviderName = "google") -> VerifiedProviderIdentity:
    return await providers.verify_oauth_callback(
        provider=provider,
        surface="web",
        code="code",
        provider_callback_url=f"https://api.example.test/auth/web/{provider}/callback",
    )


def test_provider_verification_error_is_provider_local() -> None:
    error = providers.ProviderVerificationError("provider_invalid", "Provider invalid.")

    assert error.code == "provider_invalid"
    assert error.message == "Provider invalid."
    assert str(error) == "Provider invalid."
    assert not isinstance(error, ProliferateError)


@pytest.mark.asyncio
async def test_identity_lower_layers_use_typed_auth_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "password_auth_enabled", False)
    with pytest.raises(AuthFlowError) as password_error:
        password.ensure_password_auth_enabled()
    _assert_auth_error(
        password_error,
        code="identity_password_auth_disabled",
        status_code=404,
        message="Email sign-in is not enabled.",
    )

    monkeypatch.setattr(settings, "mobile_redirect_uri", "proliferate://auth/callback")
    with pytest.raises(AuthFlowError) as service_error:
        service.validate_redirect_uri("mobile", "wrong://auth/callback")
    _assert_auth_error(
        service_error,
        code="identity_mobile_redirect_uri_not_allowed",
        status_code=400,
        message="Mobile redirect URI is not allowed.",
    )

    monkeypatch.setattr(sessions, "consume_auth_code", AsyncMock(return_value=None))
    with pytest.raises(AuthFlowError) as session_error:
        await sessions.exchange_auth_code(
            cast(AsyncSession, object()),
            code="missing",
            code_verifier="verifier",
        )
    _assert_auth_error(
        session_error,
        code="identity_auth_code_invalid",
        status_code=400,
        message="Invalid, expired, or consumed auth code.",
    )


@pytest.mark.asyncio
async def test_github_missing_email_has_provider_local_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        github_oauth_client,
        "get_access_token",
        AsyncMock(return_value={"access_token": "github-token"}),
    )
    monkeypatch.setattr(
        github_oauth_client,
        "get_id_email",
        AsyncMock(return_value=("github-subject", None)),
    )
    monkeypatch.setattr(
        providers,
        "get_github_user_profile",
        AsyncMock(side_effect=GitHubIntegrationError("profile unavailable")),
    )

    with pytest.raises(providers.ProviderVerificationError) as exc_info:
        await _verify_oauth("github")

    _assert_provider_error(
        exc_info,
        code="identity_github_email_missing",
        message="GitHub did not return an email address.",
    )


def _install_google_legacy_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        google_oauth_client,
        "get_access_token",
        AsyncMock(return_value={"access_token": "google-token"}),
    )


@pytest.mark.parametrize(
    ("profile", "code", "message"),
    [
        (
            GetIdEmailError(response=_provider_response()),
            "identity_google_profile_unusable",
            "Google did not return a usable account profile.",
        ),
        (
            ("google-subject", None),
            "identity_google_email_missing",
            "Google did not return an email address.",
        ),
    ],
)
@pytest.mark.asyncio
async def test_google_legacy_failures_have_provider_local_codes(
    monkeypatch: pytest.MonkeyPatch,
    profile: object,
    code: str,
    message: str,
) -> None:
    _install_google_legacy_token(monkeypatch)
    get_id_email = AsyncMock()
    if isinstance(profile, Exception):
        get_id_email.side_effect = profile
    else:
        get_id_email.return_value = profile
    monkeypatch.setattr(
        google_oauth_client,
        "get_id_email",
        get_id_email,
    )

    with pytest.raises(providers.ProviderVerificationError) as exc_info:
        await _verify_oauth()

    _assert_provider_error(exc_info, code=code, message=message)
    if isinstance(profile, Exception):
        assert exc_info.value.__cause__ is profile


@pytest.mark.asyncio
async def test_unsupported_oauth_provider_has_provider_local_code() -> None:
    with pytest.raises(providers.ProviderVerificationError) as exc_info:
        await _verify_oauth("apple")

    _assert_provider_error(
        exc_info,
        code="identity_oauth_provider_unsupported",
        message="Unsupported OAuth provider.",
    )


@pytest.mark.parametrize(
    ("claims", "code", "message"),
    [
        (
            {"email": "google@example.com"},
            "identity_google_subject_missing",
            "Google subject is missing.",
        ),
        (
            {"sub": "google-subject"},
            "identity_google_email_missing",
            "Google did not return an email address.",
        ),
    ],
)
def test_google_claim_failures_have_provider_local_codes(
    claims: dict[str, object],
    code: str,
    message: str,
) -> None:
    with pytest.raises(providers.ProviderVerificationError) as exc_info:
        providers._verified_google_identity_from_claims(
            {"access_token": "google-token"},
            claims,
        )

    _assert_provider_error(exc_info, code=code, message=message)


@pytest.mark.parametrize(
    "payload",
    [ValueError("invalid JSON"), ["not", "an", "object"]],
)
@pytest.mark.asyncio
async def test_google_userinfo_failures_have_provider_local_code(
    monkeypatch: pytest.MonkeyPatch, payload: object
) -> None:
    _install_json_response(monkeypatch, payload)

    with pytest.raises(providers.ProviderVerificationError) as exc_info:
        await providers._fetch_google_userinfo("google-token")

    _assert_provider_error(
        exc_info,
        code="identity_google_profile_unusable",
        message="Google did not return a usable account profile.",
    )
    if isinstance(payload, Exception):
        assert exc_info.value.__cause__ is payload


@pytest.mark.parametrize(
    ("payload", "code", "message"),
    [
        ({}, "identity_google_jwks_invalid", "Google JWKS is invalid."),
        (
            {"keys": []},
            "identity_google_identity_token_unverified",
            "Google identity token could not be verified.",
        ),
    ],
)
@pytest.mark.asyncio
async def test_google_jwks_failures_have_provider_local_codes(
    monkeypatch: pytest.MonkeyPatch,
    payload: dict[str, object],
    code: str,
    message: str,
) -> None:
    _install_json_response(monkeypatch, payload)

    with pytest.raises(providers.ProviderVerificationError) as exc_info:
        await providers._decode_google_id_token("google-id-token")

    _assert_provider_error(exc_info, code=code, message=message)


@pytest.mark.asyncio
async def test_apple_missing_subject_has_provider_local_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        providers,
        "_decode_apple_identity_token",
        AsyncMock(return_value={}),
    )

    with pytest.raises(providers.ProviderVerificationError) as exc_info:
        await providers.verify_apple_identity_token(
            identity_token="apple-token",
            expected_nonce="nonce",
            surface="mobile",
            email_hint=None,
            display_name_hint=None,
        )

    _assert_provider_error(
        exc_info,
        code="identity_apple_subject_missing",
        message="Apple subject is missing.",
    )


@pytest.mark.parametrize(
    ("payload", "code", "message"),
    [
        ({}, "identity_apple_jwks_invalid", "Apple JWKS is invalid."),
        (
            {"keys": []},
            "identity_apple_identity_token_unverified",
            "Apple identity token could not be verified.",
        ),
    ],
)
@pytest.mark.asyncio
async def test_apple_jwks_failures_have_provider_local_codes(
    monkeypatch: pytest.MonkeyPatch,
    payload: dict[str, object],
    code: str,
    message: str,
) -> None:
    _install_json_response(monkeypatch, payload)

    with pytest.raises(providers.ProviderVerificationError) as exc_info:
        await providers._decode_apple_identity_token(
            identity_token="apple-token",
            expected_nonce="nonce",
            surface="mobile",
        )

    _assert_provider_error(exc_info, code=code, message=message)


@pytest.mark.parametrize(
    ("claims", "code", "message"),
    [
        ({}, "identity_apple_nonce_missing", "Apple nonce is missing."),
        ({"nonce": "wrong"}, "identity_apple_nonce_mismatch", "Apple nonce mismatch."),
    ],
)
def test_apple_nonce_failures_have_provider_local_codes(
    claims: dict[str, object],
    code: str,
    message: str,
) -> None:
    with pytest.raises(providers.ProviderVerificationError) as exc_info:
        providers._validate_apple_nonce(claims, "expected")

    _assert_provider_error(exc_info, code=code, message=message)


@pytest.mark.asyncio
async def test_google_id_token_verification_error_falls_back_to_userinfo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected = _verified_identity(email="google@example.com")
    monkeypatch.setattr(
        google_oauth_client,
        "get_access_token",
        AsyncMock(return_value={"access_token": "google-token", "id_token": "id-token"}),
    )
    monkeypatch.setattr(
        providers,
        "_verified_google_identity_from_id_token",
        AsyncMock(
            side_effect=providers.ProviderVerificationError(
                "identity_google_identity_token_unverified",
                "Google identity token could not be verified.",
            )
        ),
    )
    userinfo = AsyncMock(return_value=expected)
    monkeypatch.setattr(providers, "_verified_google_identity_from_userinfo", userinfo)

    actual = await _verify_oauth()

    assert actual is expected
    userinfo.assert_awaited_once()


@pytest.mark.asyncio
async def test_google_id_token_nonclassified_error_propagates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_error = RuntimeError("unexpected verification failure")
    monkeypatch.setattr(
        google_oauth_client,
        "get_access_token",
        AsyncMock(return_value={"access_token": "google-token", "id_token": "id-token"}),
    )
    monkeypatch.setattr(
        providers,
        "_verified_google_identity_from_id_token",
        AsyncMock(side_effect=source_error),
    )
    userinfo = AsyncMock()
    monkeypatch.setattr(providers, "_verified_google_identity_from_userinfo", userinfo)

    with pytest.raises(RuntimeError) as exc_info:
        await _verify_oauth()

    assert exc_info.value is source_error
    userinfo.assert_not_awaited()


def _install_challenge(monkeypatch: pytest.MonkeyPatch, challenge: AuthChallengeSnapshot) -> None:
    monkeypatch.setattr(
        accounts_service,
        "consume_provider_challenge",
        AsyncMock(return_value=challenge),
    )


@pytest.mark.asyncio
async def test_oauth_service_translates_provider_verification_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_challenge(monkeypatch, _challenge())
    monkeypatch.setattr(
        providers,
        "provider_callback_url",
        lambda *args, **kwargs: "https://api.example.test/auth/web/google/callback",
    )
    source_error = providers.ProviderVerificationError(
        "identity_google_email_missing",
        "Google did not return an email address.",
    )
    monkeypatch.setattr(
        providers,
        "verify_oauth_callback",
        AsyncMock(side_effect=source_error),
    )
    with pytest.raises(AuthFlowError) as exc_info:
        await accounts_service.complete_oauth_provider_callback(
            cast(AsyncSession, object()),
            cast(Request, object()),
            provider="google",
            surface="web",
            state="state",
            code="code",
        )

    _assert_auth_error(
        exc_info,
        code="identity_google_email_missing",
        status_code=400,
        message="Google did not return an email address.",
    )
    assert exc_info.value.__cause__ is source_error


@pytest.mark.parametrize(("surface", "callback"), [("mobile", "mobile"), ("web", "web")])
@pytest.mark.asyncio
async def test_apple_services_translate_provider_verification_error(
    monkeypatch: pytest.MonkeyPatch,
    surface: str,
    callback: str,
) -> None:
    _install_challenge(monkeypatch, _challenge(provider="apple", surface=surface))
    source_error = providers.ProviderVerificationError(
        "identity_apple_nonce_mismatch",
        "Apple nonce mismatch.",
    )
    monkeypatch.setattr(
        providers,
        "verify_apple_identity_token",
        AsyncMock(side_effect=source_error),
    )

    with pytest.raises(AuthFlowError) as exc_info:
        if callback == "mobile":
            await accounts_service.complete_apple_mobile_login(
                cast(AsyncSession, object()),
                state="state",
                identity_token="token",
                email=None,
                display_name=None,
            )
        else:
            await accounts_service.complete_apple_web_callback(
                cast(AsyncSession, object()),
                state="state",
                identity_token="token",
                email=None,
                display_name=None,
            )

    _assert_auth_error(
        exc_info,
        code="identity_apple_nonce_mismatch",
        status_code=400,
        message="Apple nonce mismatch.",
    )
    assert exc_info.value.__cause__ is source_error


@pytest.mark.asyncio
async def test_oauth_provider_token_rejection_keeps_redirect_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_challenge(monkeypatch, _challenge())
    monkeypatch.setattr(
        providers,
        "provider_callback_url",
        lambda *args, **kwargs: "https://api.example.test/auth/web/google/callback",
    )
    monkeypatch.setattr(
        providers,
        "verify_oauth_callback",
        AsyncMock(side_effect=providers.OAuthProviderTokenRejectedError()),
    )

    redirect = await accounts_service.complete_oauth_provider_callback(
        cast(AsyncSession, object()),
        cast(Request, object()),
        provider="google",
        surface="web",
        state="state",
        code="code",
    )

    assert (
        redirect == "https://client.example.test/callback?error=provider_error&state=client-state"
    )
