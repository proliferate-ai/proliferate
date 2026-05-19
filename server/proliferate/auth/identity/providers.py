"""Provider protocol adapters for product auth."""

from __future__ import annotations

import hashlib
import secrets
import time
from datetime import UTC, datetime
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, Request, status
from httpx_oauth.exceptions import GetIdEmailError
from jose import JWTError, jwt

from proliferate.auth.identity.routing import auth_route_path_for_base
from proliferate.auth.identity.types import AuthProviderName, VerifiedProviderIdentity
from proliferate.auth.oauth import github_oauth_client, google_oauth_client
from proliferate.config import settings
from proliferate.constants.auth import GITHUB_OAUTH_SCOPES
from proliferate.integrations.github import GitHubIntegrationError, get_github_user_profile

GOOGLE_OAUTH_SCOPES = ["openid", "email", "profile"]
GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
APPLE_AUTHORIZE_URL = "https://appleid.apple.com/auth/authorize"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"


def parse_scope_string(value: object) -> frozenset[str]:
    if isinstance(value, str):
        return frozenset(scope for scope in value.replace(",", " ").split() if scope)
    if isinstance(value, list):
        return frozenset(scope for scope in value if isinstance(scope, str))
    return frozenset()


def token_expiry_from_timestamp(value: object) -> datetime | None:
    if isinstance(value, int | float):
        return datetime.fromtimestamp(value, tz=UTC)
    return None


def token_expiry_timestamp(value: object) -> int | None:
    if isinstance(value, int | float):
        return int(value)
    return None


def provider_enabled(provider: AuthProviderName, *, surface: str) -> bool:
    match provider:
        case "github":
            return bool(settings.github_oauth_client_id and settings.github_oauth_client_secret)
        case "google":
            return bool(settings.google_oauth_client_id and settings.google_oauth_client_secret)
        case "apple":
            if not settings.apple_sign_in_enabled:
                return False
            if surface == "web":
                return bool(settings.apple_web_service_id)
            if surface == "mobile":
                return bool(settings.apple_ios_bundle_id)
            return False


def apple_client_id_for_surface(surface: str) -> str:
    if surface == "web":
        return settings.apple_web_service_id
    return settings.apple_ios_bundle_id


async def build_authorization_url(
    *,
    provider: AuthProviderName,
    surface: str,
    provider_callback_url: str,
    state: str,
    nonce: str,
    prompt: str | None,
) -> str | None:
    if provider == "github":
        extras = {"prompt": prompt} if prompt else None
        return await github_oauth_client.get_authorization_url(
            provider_callback_url,
            state,
            GITHUB_OAUTH_SCOPES,
            extras_params=extras,
        )
    if provider == "google":
        extras = {"prompt": "select_account"} if prompt else None
        return await google_oauth_client.get_authorization_url(
            provider_callback_url,
            state,
            GOOGLE_OAUTH_SCOPES,
            extras_params=extras,
        )
    if provider == "apple" and surface == "web":
        return (
            f"{APPLE_AUTHORIZE_URL}?"
            + urlencode(
                {
                    "client_id": apple_client_id_for_surface(surface),
                    "redirect_uri": provider_callback_url,
                    "response_type": "code id_token",
                    "response_mode": "form_post",
                    "scope": "name email",
                    "state": state,
                    "nonce": nonce,
                }
            )
        )
    return None


async def verify_oauth_callback(
    *,
    provider: AuthProviderName,
    surface: str,
    code: str,
    provider_callback_url: str,
) -> VerifiedProviderIdentity:
    if provider == "github":
        token = await github_oauth_client.get_access_token(code, provider_callback_url)
        access_token = str(token["access_token"])
        account_id, account_email = await github_oauth_client.get_id_email(access_token)
        if account_email is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="GitHub did not return an email address.",
            )
        display_name: str | None = None
        provider_login: str | None = None
        avatar_url: str | None = None
        try:
            profile = await get_github_user_profile(access_token)
            provider_login = profile.login
            display_name = profile.display_name
            avatar_url = profile.avatar_url
        except GitHubIntegrationError:
            pass
        return VerifiedProviderIdentity(
            provider="github",
            provider_subject=account_id,
            email=account_email,
            email_verified=True,
            display_name=display_name,
            provider_login=provider_login,
            avatar_url=avatar_url,
            access_token=access_token,
            refresh_token=(
                token.get("refresh_token") if isinstance(token.get("refresh_token"), str) else None
            ),
            expires_at=token_expiry_from_timestamp(token.get("expires_at")),
            expires_at_timestamp=token_expiry_timestamp(token.get("expires_at")),
            scopes=parse_scope_string(token.get("scope")),
        )

    if provider == "google":
        token = await google_oauth_client.get_access_token(code, provider_callback_url)
        access_token = str(token["access_token"])
        id_token = token.get("id_token")
        if isinstance(id_token, str) and id_token:
            try:
                return await _verified_google_identity_from_id_token(token, id_token)
            except HTTPException:
                return await _verified_google_identity_from_userinfo(token)
        try:
            account_id, account_email = await google_oauth_client.get_id_email(access_token)
        except GetIdEmailError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Google did not return a usable account profile.",
            ) from exc
        if account_email is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Google did not return an email address.",
            )
        return VerifiedProviderIdentity(
            provider="google",
            provider_subject=account_id,
            email=account_email,
            email_verified=True,
            display_name=None,
            provider_login=None,
            avatar_url=None,
            access_token=access_token,
            refresh_token=(
                token.get("refresh_token") if isinstance(token.get("refresh_token"), str) else None
            ),
            expires_at=token_expiry_from_timestamp(token.get("expires_at")),
            expires_at_timestamp=token_expiry_timestamp(token.get("expires_at")),
            scopes=parse_scope_string(token.get("scope")),
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Unsupported OAuth provider.",
    )


async def _verified_google_identity_from_id_token(
    token: dict[str, object],
    id_token: str,
) -> VerifiedProviderIdentity:
    claims = await _decode_google_id_token(id_token)
    return _verified_google_identity_from_claims(token, claims)


async def _verified_google_identity_from_userinfo(
    token: dict[str, object],
) -> VerifiedProviderIdentity:
    access_token = str(token["access_token"])
    claims = await _fetch_google_userinfo(access_token)
    return _verified_google_identity_from_claims(token, claims)


def _verified_google_identity_from_claims(
    token: dict[str, object],
    claims: dict[str, object],
) -> VerifiedProviderIdentity:
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google subject is missing.",
        )
    email = claims.get("email") if isinstance(claims.get("email"), str) else None
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google did not return an email address.",
        )
    email_verified = claims.get("email_verified")
    display_name = claims.get("name") if isinstance(claims.get("name"), str) else None
    avatar_url = claims.get("picture") if isinstance(claims.get("picture"), str) else None
    access_token = str(token["access_token"])
    return VerifiedProviderIdentity(
        provider="google",
        provider_subject=subject,
        email=email,
        email_verified=email_verified in {True, "true", "1"},
        display_name=display_name,
        provider_login=None,
        avatar_url=avatar_url,
        access_token=access_token,
        refresh_token=(
            token.get("refresh_token") if isinstance(token.get("refresh_token"), str) else None
        ),
        expires_at=token_expiry_from_timestamp(token.get("expires_at")),
        expires_at_timestamp=token_expiry_timestamp(token.get("expires_at")),
        scopes=parse_scope_string(token.get("scope")),
    )


async def _fetch_google_userinfo(access_token: str) -> dict[str, object]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            payload = response.json()
    except (ValueError, httpx.HTTPError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google did not return a usable account profile.",
        ) from exc

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google did not return a usable account profile.",
        )
    return payload


async def _decode_google_id_token(id_token: str) -> dict[str, object]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        jwks = (await client.get(GOOGLE_JWKS_URL)).json()
    keys = jwks.get("keys")
    if not isinstance(keys, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google JWKS is invalid.",
        )

    last_error: Exception | None = None
    for key in keys:
        if not isinstance(key, dict):
            continue
        try:
            claims = jwt.decode(
                id_token,
                key,
                algorithms=["RS256"],
                audience=settings.google_oauth_client_id,
            )
            issuer = claims.get("iss")
            if issuer not in GOOGLE_ISSUERS:
                raise JWTError("Unexpected Google issuer.")
            return dict(claims)
        except JWTError as exc:
            last_error = exc
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Google identity token could not be verified.",
    ) from last_error


async def verify_apple_identity_token(
    *,
    identity_token: str,
    expected_nonce: str,
    surface: str,
    email_hint: str | None,
    display_name_hint: str | None,
) -> VerifiedProviderIdentity:
    claims = await _decode_apple_identity_token(
        identity_token=identity_token,
        expected_nonce=expected_nonce,
        surface=surface,
    )
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Apple subject is missing.",
        )
    signed_email = claims.get("email") if isinstance(claims.get("email"), str) else None
    email_verified = claims.get("email_verified")
    return VerifiedProviderIdentity(
        provider="apple",
        provider_subject=subject,
        email=signed_email,
        email_verified=signed_email is not None and email_verified in {True, "true", "1"},
        display_name=display_name_hint,
        provider_login=None,
        avatar_url=None,
        access_token=None,
        refresh_token=None,
        expires_at=None,
        expires_at_timestamp=None,
        scopes=frozenset(),
    )


async def _decode_apple_identity_token(
    *,
    identity_token: str,
    expected_nonce: str,
    surface: str,
) -> dict[str, object]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        jwks = (await client.get(APPLE_JWKS_URL)).json()
    keys = jwks.get("keys")
    if not isinstance(keys, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Apple JWKS is invalid.",
        )

    allowed_audience = apple_client_id_for_surface(surface)
    last_error: Exception | None = None
    for key in keys:
        if not isinstance(key, dict):
            continue
        try:
            claims = jwt.decode(
                identity_token,
                key,
                algorithms=["RS256"],
                audience=allowed_audience,
                issuer=APPLE_ISSUER,
            )
            _validate_apple_nonce(claims, expected_nonce)
            return dict(claims)
        except JWTError as exc:
            last_error = exc
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Apple identity token could not be verified.",
    ) from last_error


def _validate_apple_nonce(claims: dict[str, object], expected_nonce: str) -> None:
    claim_nonce = claims.get("nonce")
    if not isinstance(claim_nonce, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Apple nonce is missing.",
        )
    expected_hash = hashlib.sha256(expected_nonce.encode("utf-8")).hexdigest()
    if claim_nonce not in {expected_nonce, expected_hash}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Apple nonce mismatch.",
        )


def build_apple_client_secret(*, surface: str) -> str:
    private_key = settings.apple_private_key.replace("\\n", "\n")
    now = int(time.time())
    return jwt.encode(
        {
            "iss": settings.apple_team_id,
            "iat": now,
            "exp": now + 60 * 60 * 24 * 30,
            "aud": APPLE_ISSUER,
            "sub": apple_client_id_for_surface(surface),
        },
        private_key,
        algorithm="ES256",
        headers={"kid": settings.apple_key_id},
    )


def provider_callback_url(request: Request, *, provider: AuthProviderName, surface: str) -> str:
    base = settings.api_base_url.strip().rstrip("/")
    if not base:
        base = str(request.base_url).rstrip("/")
    path = auth_route_path_for_base(
        f"/auth/{surface}/{provider}/callback",
        base_url=base,
    )
    return f"{base}{path}"


def new_secret() -> str:
    return secrets.token_urlsafe(32)
