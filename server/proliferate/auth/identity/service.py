"""Product auth identity orchestration."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import UUID

from fastapi import HTTPException, Request
from fastapi_users.jwt import decode_jwt, generate_jwt
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity import providers
from proliferate.auth.identity.models import AccountReadinessResponse, AuthSessionResponse
from proliferate.auth.identity.store import (
    consume_auth_challenge,
    create_auth_challenge,
    create_auth_user,
    get_account_readiness,
    get_identity_by_provider_subject,
    get_user_by_email,
    get_user_by_id,
    linked_provider_payloads,
    mirror_legacy_oauth_account,
    upsert_identity_for_user,
    upsert_provider_grant,
)
from proliferate.auth.identity.types import (
    AccountReadiness,
    AuthChallengeSnapshot,
    AuthProviderName,
    AuthSession,
    VerifiedProviderIdentity,
)
from proliferate.auth.jwt import get_jwt_strategy
from proliferate.auth.models import AuthLinkedProvider, AuthProviderAvailability, UserRead
from proliferate.auth.pkce import verify_pkce
from proliferate.config import settings
from proliferate.constants.auth import (
    AUTH_CODE_LIFETIME_SECONDS,
    JWT_LIFETIME_SECONDS,
    REFRESH_TOKEN_LIFETIME_SECONDS,
    SUPPORTED_CODE_CHALLENGE_METHODS,
)
from proliferate.db.models.auth import User
from proliferate.db.store.auth import consume_auth_code, create_auth_code

AUTH_CHALLENGE_LIFETIME_SECONDS = 600
WEB_REFRESH_COOKIE = "proliferate_web_refresh"
WEB_CSRF_COOKIE = "proliferate_web_csrf"
WEB_CSRF_HEADER = "x-proliferate-csrf"


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
            raise HTTPException(status_code=400, detail="Mobile redirect URI is not allowed.")
        return
    if surface == "web":
        parsed = urlparse(redirect_uri)
        allowed = _allowed_web_redirect_origins()
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in allowed:
            raise HTTPException(status_code=400, detail="Web redirect URI origin is not allowed.")
        return
    raise HTTPException(status_code=400, detail="Unsupported auth surface.")


def _allowed_web_redirect_origins() -> set[str]:
    origins = {
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    }
    if settings.frontend_base_url:
        parsed = urlparse(settings.frontend_base_url.strip())
        origins.add(f"{parsed.scheme}://{parsed.netloc}")
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
        raise HTTPException(status_code=404, detail="Unknown auth provider.")
    if not providers.provider_enabled(provider, surface=surface):
        raise HTTPException(status_code=503, detail=f"{provider} sign-in is not configured.")
    if purpose != "login" and user is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication is required to link providers.",
        )
    if code_challenge_method not in SUPPORTED_CODE_CHALLENGE_METHODS:
        raise HTTPException(status_code=400, detail="Unsupported code challenge method.")
    validate_redirect_uri(surface, redirect_uri)

    state = providers.new_secret()
    nonce = hash_secret(providers.new_secret()) if provider == "apple" else providers.new_secret()
    csrf = providers.new_secret() if surface in {"web", "mobile"} else None
    expires_at = datetime.now(UTC) + timedelta(seconds=AUTH_CHALLENGE_LIFETIME_SECONDS)
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
        provider_callback_url=providers.provider_callback_url(
            request,
            provider=provider,
            surface=surface,
        ),
        state=state,
        nonce=nonce,
        prompt=prompt,
    )
    return authorization_url, state, nonce, expires_at


async def complete_oauth_provider_callback(
    db: AsyncSession,
    request: Request,
    *,
    provider: AuthProviderName,
    surface: str,
    state: str,
    code: str,
) -> str:
    challenge = await _consume_challenge_for_callback(
        db,
        state=state,
        provider=provider,
        surface=surface,
    )
    verified = await providers.verify_oauth_callback(
        provider=provider,
        surface=surface,
        code=code,
        provider_callback_url=providers.provider_callback_url(
            request,
            provider=provider,
            surface=surface,
        ),
    )
    user = await resolve_provider_user(db, verified=verified, challenge=challenge)
    auth_code = await create_auth_code(
        db,
        user_id=user.id,
        code_challenge=challenge.code_challenge,
        code_challenge_method=challenge.code_challenge_method,
        state=challenge.client_state,
        redirect_uri=challenge.redirect_uri,
    )
    return append_query(challenge.redirect_uri, code=auth_code.code, state=challenge.client_state)


async def complete_oauth_provider_error_callback(
    db: AsyncSession,
    *,
    provider: AuthProviderName,
    surface: str,
    state: str,
    error: str,
) -> str:
    challenge = await _consume_challenge_for_callback(
        db,
        state=state,
        provider=provider,
        surface=surface,
    )
    return append_query(challenge.redirect_uri, error=error, state=challenge.client_state)


async def complete_apple_mobile_login(
    db: AsyncSession,
    *,
    state: str,
    identity_token: str,
    email: str | None,
    display_name: str | None,
) -> AuthSession:
    challenge = await _consume_challenge_for_callback(
        db,
        state=state,
        provider="apple",
        surface="mobile",
    )
    verified = await providers.verify_apple_identity_token(
        identity_token=identity_token,
        expected_nonce=_nonce_unavailable_marker(challenge),
        surface=challenge.surface,
        email_hint=email,
        display_name_hint=display_name,
    )
    user = await resolve_provider_user(db, verified=verified, challenge=challenge)
    return await mint_auth_session(db, user=user)


async def complete_apple_web_callback(
    db: AsyncSession,
    *,
    state: str,
    identity_token: str,
    email: str | None,
    display_name: str | None,
) -> str:
    challenge = await _consume_challenge_for_callback(
        db,
        state=state,
        provider="apple",
        surface="web",
    )
    verified = await providers.verify_apple_identity_token(
        identity_token=identity_token,
        expected_nonce=_nonce_unavailable_marker(challenge),
        surface=challenge.surface,
        email_hint=email,
        display_name_hint=display_name,
    )
    user = await resolve_provider_user(db, verified=verified, challenge=challenge)
    auth_code = await create_auth_code(
        db,
        user_id=user.id,
        code_challenge=challenge.code_challenge,
        code_challenge_method=challenge.code_challenge_method,
        state=challenge.client_state,
        redirect_uri=challenge.redirect_uri,
    )
    return append_query(challenge.redirect_uri, code=auth_code.code, state=challenge.client_state)


def _nonce_unavailable_marker(challenge: AuthChallengeSnapshot) -> str:
    # We store only the nonce hash at rest. Apple verification accepts the hash
    # as the expected nonce so the raw nonce never needs to be persisted.
    return challenge.nonce_hash


async def _consume_challenge_for_callback(
    db: AsyncSession,
    *,
    state: str,
    provider: AuthProviderName,
    surface: str,
) -> AuthChallengeSnapshot:
    challenge = await consume_auth_challenge(db, state_hash=hash_secret(state))
    if challenge is None or challenge.provider != provider or challenge.surface != surface:
        raise HTTPException(status_code=400, detail="Invalid or expired auth state.")
    return challenge


async def resolve_provider_user(
    db: AsyncSession,
    *,
    verified: VerifiedProviderIdentity,
    challenge: AuthChallengeSnapshot,
) -> User:
    existing_identity = await get_identity_by_provider_subject(
        db,
        provider=verified.provider,
        provider_subject=verified.provider_subject,
    )

    if challenge.purpose != "login":
        if challenge.user_id is None:
            raise HTTPException(status_code=401, detail="Authentication is required.")
        if existing_identity is not None and existing_identity.user_id != challenge.user_id:
            raise HTTPException(status_code=409, detail="Provider identity already linked.")
        user = await get_user_by_id(db, challenge.user_id)
        if user is None:
            raise HTTPException(status_code=400, detail="User not found.")
        await attach_verified_identity(db, user=user, verified=verified)
        return user

    if existing_identity is not None:
        user = await get_user_by_id(db, existing_identity.user_id)
        if user is None:
            raise HTTPException(status_code=400, detail="Linked user not found.")
        await attach_verified_identity(db, user=user, verified=verified)
        return user

    email = _email_for_new_user(verified)
    if verified.email and await get_user_by_email(db, verified.email) is not None:
        raise HTTPException(
            status_code=409,
            detail="An account already exists for this email. Sign in with GitHub to link it.",
        )
    user = await create_auth_user(
        db,
        email=email,
        display_name=verified.display_name,
        avatar_url=verified.avatar_url,
    )
    await attach_verified_identity(db, user=user, verified=verified)
    return user


def _email_for_new_user(verified: VerifiedProviderIdentity) -> str:
    if verified.email:
        return verified.email
    subject_hash = hash_secret(f"{verified.provider}:{verified.provider_subject}")[:24]
    return f"{verified.provider}-{subject_hash}@auth.proliferate.local"


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


async def exchange_auth_code(
    db: AsyncSession,
    *,
    code: str,
    code_verifier: str,
) -> AuthSession:
    auth_code = await consume_auth_code(db, code=code)
    if auth_code is None:
        raise HTTPException(status_code=400, detail="Invalid, expired, or consumed auth code.")
    if not verify_pkce(
        code_verifier,
        auth_code.code_challenge,
        auth_code.code_challenge_method,
    ):
        raise HTTPException(status_code=400, detail="PKCE verification failed.")
    if _auth_code_expired(auth_code.created_at):
        raise HTTPException(status_code=400, detail="Auth code expired.")
    user = await get_user_by_id(db, auth_code.user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="User not found.")
    return await mint_auth_session(db, user=user)


def _auth_code_expired(created_at: datetime) -> bool:
    created = created_at if created_at.tzinfo else created_at.replace(tzinfo=UTC)
    return datetime.now(UTC) > created + timedelta(seconds=AUTH_CODE_LIFETIME_SECONDS)


async def mint_auth_session(db: AsyncSession, *, user: User) -> AuthSession:
    access_token = await get_jwt_strategy().write_token(user)
    refresh_token = generate_jwt(
        data={"sub": str(user.id), "aud": "proliferate:refresh"},
        secret=settings.jwt_secret,
        lifetime_seconds=REFRESH_TOKEN_LIFETIME_SECONDS,
    )
    readiness = await get_account_readiness(db, user_id=user.id)
    return AuthSession(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=JWT_LIFETIME_SECONDS,
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        github_login=user.github_login,
        avatar_url=user.avatar_url,
        readiness=readiness,
    )


async def refresh_auth_session(db: AsyncSession, *, refresh_token: str) -> AuthSession:
    try:
        payload = decode_jwt(
            refresh_token,
            secret=settings.jwt_secret,
            audience=["proliferate:refresh"],
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token.") from exc
    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        raise HTTPException(status_code=401, detail="Invalid refresh token payload.")
    user = await get_user_by_id(db, UUID(user_id))
    if user is None:
        raise HTTPException(status_code=401, detail="User not found.")
    return await mint_auth_session(db, user=user)


async def auth_viewer_payload(
    db: AsyncSession,
    *,
    user: User,
) -> tuple[bool, str, list[AuthLinkedProvider], list[AuthProviderAvailability]]:
    readiness = await get_account_readiness(db, user_id=user.id)
    identities = await linked_provider_payloads(db, user_id=user.id)
    by_provider = {identity.provider: identity for identity in identities}
    linked = [
        AuthLinkedProvider(
            provider=provider,  # type: ignore[arg-type]
            connected=provider in by_provider,
            account_email=by_provider[provider].email if provider in by_provider else None,
            account_id=(
                by_provider[provider].provider_subject if provider in by_provider else None
            ),
        )
        for provider in ("github", "google", "apple")
    ]
    availability = [
        AuthProviderAvailability(
            provider=provider,  # type: ignore[arg-type]
            enabled=providers.provider_enabled(provider, surface="web"),  # type: ignore[arg-type]
            reason=(
                None
                if providers.provider_enabled(provider, surface="web")
                else "not_configured"
            ),
        )
        for provider in ("github", "google", "apple")
    ]
    return (
        readiness.product_ready,
        "active" if readiness.product_ready else "needs_github",
        linked,
        availability,
    )


def auth_session_response(
    session: AuthSession,
    *,
    include_refresh_token: bool,
) -> AuthSessionResponse:
    return AuthSessionResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token if include_refresh_token else None,
        expires_in=session.expires_in,
        user=UserRead(
            id=session.user_id,
            email=session.email,
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name=session.display_name,
            github_login=session.github_login,
            avatar_url=session.avatar_url,
        ),
        readiness=readiness_response(session.readiness),
    )


def readiness_response(readiness: AccountReadiness) -> AccountReadinessResponse:
    return AccountReadinessResponse(
        product_ready=readiness.product_ready,
        missing_requirements=list(readiness.missing_requirements),
        github_identity_id=(
            str(readiness.github_identity_id) if readiness.github_identity_id else None
        ),
        github_grant_status=readiness.github_grant_status,
    )
