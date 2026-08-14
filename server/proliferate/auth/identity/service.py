"""Transport-neutral identity and provider protocol primitives."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.errors import AuthFlowError
from proliferate.auth.identity import providers
from proliferate.auth.identity.store import (
    consume_auth_challenge,
    create_auth_challenge,
    mirror_legacy_oauth_account,
    upsert_identity_for_user,
    upsert_provider_grant,
)
from proliferate.auth.identity.types import (
    AuthCallbackRedirect,
    AuthChallengeSnapshot,
    AuthProviderName,
    VerifiedProviderIdentity,
)
from proliferate.config import settings
from proliferate.constants.auth import DESKTOP_REDIRECT_SCHEMES, SUPPORTED_CODE_CHALLENGE_METHODS
from proliferate.db.models.auth import User

AUTH_CHALLENGE_LIFETIME_SECONDS = 600


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def append_query(base_url: str, **params: str) -> str:
    parsed = urlparse(base_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.update(params)
    return urlunparse(parsed._replace(query=urlencode(query)))


def validate_redirect_uri(surface: str, redirect_uri: str) -> None:
    if surface == "mobile":
        if redirect_uri != settings.mobile_redirect_uri:
            raise AuthFlowError(
                "identity_mobile_redirect_uri_not_allowed",
                "Mobile redirect URI is not allowed.",
                status_code=400,
            )
        return
    if surface == "desktop":
        parsed = urlparse(redirect_uri)
        if parsed.scheme not in DESKTOP_REDIRECT_SCHEMES:
            desktop_schemes = ", ".join(sorted(DESKTOP_REDIRECT_SCHEMES))
            detail = (
                f"Desktop redirect URI must use a configured desktop scheme: {desktop_schemes}."
            )
            raise AuthFlowError(
                "identity_desktop_redirect_uri_not_allowed",
                detail,
                status_code=400,
            )
        return
    if surface == "web":
        if not _is_allowed_web_redirect_uri(redirect_uri):
            raise AuthFlowError(
                "identity_web_redirect_uri_not_allowed",
                "Web redirect URI origin is not allowed.",
                status_code=400,
            )
        return
    raise AuthFlowError(
        "identity_surface_unsupported", "Unsupported auth surface.", status_code=400
    )


def _is_allowed_web_redirect_uri(redirect_uri: str) -> bool:
    parsed = urlparse(redirect_uri)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return origin in _allowed_web_redirect_origins()


def _allowed_web_redirect_origins() -> set[str]:
    origins = {
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    }
    if settings.frontend_base_url:
        parsed = urlparse(settings.frontend_base_url.strip())
        origins.update(_loopback_origin_aliases(parsed.scheme, parsed.hostname, parsed.port))
    for raw_origin in settings.cors_allow_origins.split(","):
        parsed = urlparse(raw_origin.strip())
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            origins.update(_loopback_origin_aliases(parsed.scheme, parsed.hostname, parsed.port))
    return origins


def _loopback_origin_aliases(scheme: str, hostname: str | None, port: int | None) -> set[str]:
    if not hostname:
        return set()
    netloc = hostname if port is None else f"{hostname}:{port}"
    origins = {f"{scheme}://{netloc}"}
    if hostname in {"localhost", "127.0.0.1"}:
        for alias in ("localhost", "127.0.0.1"):
            alias_netloc = alias if port is None else f"{alias}:{port}"
            origins.add(f"{scheme}://{alias_netloc}")
    return origins


async def start_provider_auth(
    db: AsyncSession,
    request: Request,
    *,
    provider: AuthProviderName,
    surface: str,
    purpose: str,
    client_state: str,
    code_challenge: str,
    code_challenge_method: str,
    redirect_uri: str,
    prompt: str | None,
    user: User | None,
) -> tuple[str | None, str, str, datetime]:
    if provider not in {"github", "google", "apple"}:
        raise AuthFlowError("identity_provider_unknown", "Unknown auth provider.", status_code=404)
    if not providers.provider_enabled(provider, surface=surface):
        raise AuthFlowError(
            "identity_provider_not_configured",
            f"{provider} sign-in is not configured.",
            status_code=503,
        )
    if purpose != "login" and user is None:
        raise AuthFlowError(
            "identity_provider_link_auth_required",
            "Authentication is required to link providers.",
            status_code=401,
        )
    if code_challenge_method not in SUPPORTED_CODE_CHALLENGE_METHODS:
        raise AuthFlowError(
            "identity_code_challenge_method_unsupported",
            "Unsupported code challenge method.",
            status_code=400,
        )
    validate_redirect_uri(surface, redirect_uri)

    state = providers.new_secret()
    nonce = hash_secret(providers.new_secret()) if provider == "apple" else providers.new_secret()
    csrf = providers.new_secret() if surface in {"web", "mobile"} else None
    expires_at = datetime.now(UTC) + timedelta(seconds=AUTH_CHALLENGE_LIFETIME_SECONDS)
    provider_callback_url = providers.provider_callback_url(
        request, provider=provider, surface=surface
    )
    await create_auth_challenge(
        db,
        provider=provider,
        surface=surface,
        purpose=purpose,
        state_hash=hash_secret(state),
        nonce_hash=nonce if provider == "apple" else hash_secret(nonce),
        csrf_hash=hash_secret(csrf) if csrf else None,
        user_id=user.id if user is not None else None,
        client_state=client_state,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        redirect_uri=redirect_uri,
        expires_at=expires_at,
    )
    authorization_url = await providers.build_authorization_url(
        provider=provider,
        surface=surface,
        provider_callback_url=provider_callback_url,
        state=state,
        nonce=nonce,
        prompt=prompt,
    )
    return authorization_url, state, nonce, expires_at


async def complete_oauth_provider_error_callback(
    db: AsyncSession,
    *,
    provider: AuthProviderName,
    surface: str | None,
    state: str,
    error: str,
) -> AuthCallbackRedirect:
    challenge = await consume_provider_challenge(
        db,
        state=state,
        provider=provider,
        surface=surface,
    )
    url = append_query(challenge.redirect_uri, error=error, state=challenge.client_state)
    return AuthCallbackRedirect(url=url, surface=challenge.surface, error=error)


async def consume_provider_challenge(
    db: AsyncSession,
    *,
    state: str,
    provider: AuthProviderName,
    surface: str | None,
) -> AuthChallengeSnapshot:
    challenge = await consume_auth_challenge(db, state_hash=hash_secret(state))
    if (
        challenge is None
        or challenge.provider != provider
        or (surface is not None and challenge.surface != surface)
    ):
        raise AuthFlowError(
            "identity_auth_state_invalid",
            "Invalid or expired auth state.",
            status_code=400,
        )
    return challenge


async def attach_verified_identity(
    db: AsyncSession,
    *,
    user: User,
    verified: VerifiedProviderIdentity,
) -> None:
    identity = await upsert_identity_for_user(db, user_id=user.id, verified=verified)
    await upsert_provider_grant(db, identity=identity, verified=verified)
    await mirror_legacy_oauth_account(db, user_id=user.id, verified=verified)
    if verified.provider == "github":
        user.github_login = verified.provider_login or verified.display_name or user.github_login
        user.avatar_url = verified.avatar_url or user.avatar_url
    if verified.display_name and not user.display_name:
        user.display_name = verified.display_name
    await db.flush()
