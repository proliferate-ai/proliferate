"""Product auth identity orchestration."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity import providers
from proliferate.auth.identity.sessions import mint_auth_session
from proliferate.auth.identity.store import (
    consume_auth_challenge,
    create_auth_challenge,
    create_auth_user,
    get_account_readiness,
    get_identity_by_provider_subject,
    get_user_by_email,
    get_user_by_id,
    merge_auth_user_into_user,
    mirror_legacy_oauth_account,
    upsert_identity_for_user,
    upsert_provider_grant,
)
from proliferate.auth.identity.types import (
    AuthChallengeSnapshot,
    AuthProviderName,
    AuthSession,
    VerifiedProviderIdentity,
)
from proliferate.auth.identity.web_beta import ensure_web_beta_email_allowed
from proliferate.config import settings
from proliferate.constants.auth import (
    DESKTOP_REDIRECT_SCHEMES,
    SUPPORTED_CODE_CHALLENGE_METHODS,
)
from proliferate.db.models.auth import User
from proliferate.db.store.auth import create_auth_code

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
            raise HTTPException(status_code=400, detail="Mobile redirect URI is not allowed.")
        return
    if surface == "desktop":
        parsed = urlparse(redirect_uri)
        if parsed.scheme not in DESKTOP_REDIRECT_SCHEMES:
            desktop_schemes = ", ".join(sorted(DESKTOP_REDIRECT_SCHEMES))
            detail = (
                f"Desktop redirect URI must use a configured desktop scheme: {desktop_schemes}."
            )
            raise HTTPException(status_code=400, detail=detail)
        return
    if surface == "web":
        if not _is_allowed_web_redirect_uri(redirect_uri):
            raise HTTPException(status_code=400, detail="Web redirect URI origin is not allowed.")
        return
    raise HTTPException(status_code=400, detail="Unsupported auth surface.")


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


def _ensure_active_user(user: User) -> None:
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is inactive.")


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


async def complete_oauth_provider_callback(
    db: AsyncSession,
    request: Request,
    *,
    provider: AuthProviderName,
    surface: str | None,
    state: str,
    code: str,
) -> str:
    challenge = await _consume_challenge_for_callback(
        db,
        state=state,
        provider=provider,
        surface=surface,
    )
    callback_surface = surface or challenge.surface
    verified = await providers.verify_oauth_callback(
        provider=provider,
        surface=callback_surface,
        code=code,
        provider_callback_url=providers.provider_callback_url(
            request, provider=provider, surface=callback_surface
        ),
    )
    if callback_surface == "web" and challenge.purpose == "login":
        ensure_web_beta_email_allowed(verified.email)
    desktop_github_account_or_email_exists = True
    if callback_surface == "desktop" and provider == "github":
        desktop_github_account_or_email_exists = await _desktop_github_account_or_email_exists(
            db,
            verified=verified,
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
    if callback_surface == "desktop" and provider == "github":
        _schedule_desktop_github_login_side_effects(
            db,
            user,
            verified=verified,
            notify_signup=not desktop_github_account_or_email_exists,
        )
    return append_query(challenge.redirect_uri, code=auth_code.code, state=challenge.client_state)


async def _desktop_github_account_or_email_exists(
    db: AsyncSession,
    *,
    verified: VerifiedProviderIdentity,
) -> bool:
    if not verified.email:
        identity = await get_identity_by_provider_subject(
            db,
            provider=verified.provider,
            provider_subject=verified.provider_subject,
        )
        return identity is not None

    from proliferate.db.store.users import github_oauth_account_or_email_exists

    return await github_oauth_account_or_email_exists(
        db,
        account_id=verified.provider_subject,
        account_email=verified.email,
    )


def _schedule_desktop_github_login_side_effects(
    db: AsyncSession,
    user: User,
    *,
    verified: VerifiedProviderIdentity,
    notify_signup: bool,
) -> None:
    from proliferate.auth.desktop.service import (
        schedule_customerio_desktop_authenticated_user_sync,
        schedule_signup_slack_notification,
    )
    from proliferate.server.notifications import SignupSlackNotification

    schedule_customerio_desktop_authenticated_user_sync(user)
    if notify_signup:
        schedule_signup_slack_notification(
            SignupSlackNotification(
                name=user.display_name or verified.display_name or user.email,
                email=user.email,
                github=user.github_login or verified.provider_login or verified.provider_subject,
                user_created_at=user.created_at,
            ),
            dedupe_key=f"github:{verified.provider_subject}",
            db=db,
        )


async def complete_oauth_provider_error_callback(
    db: AsyncSession,
    *,
    provider: AuthProviderName,
    surface: str | None,
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
    if challenge.purpose == "login":
        ensure_web_beta_email_allowed(verified.email)
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
    surface: str | None,
) -> AuthChallengeSnapshot:
    challenge = await consume_auth_challenge(db, state_hash=hash_secret(state))
    if (
        challenge is None
        or challenge.provider != provider
        or (surface is not None and challenge.surface != surface)
    ):
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
            current_user = await get_user_by_id(db, challenge.user_id)
            linked_user = await get_user_by_id(db, existing_identity.user_id)
            if current_user is None or linked_user is None:
                raise HTTPException(status_code=400, detail="Linked user not found.")
            _ensure_active_user(current_user)
            _ensure_active_user(linked_user)
            current_readiness = await get_account_readiness(db, user_id=current_user.id)
            linked_readiness = await get_account_readiness(db, user_id=linked_user.id)
            if (
                verified.provider == "github"
                and not current_readiness.product_ready
                and linked_readiness.product_ready
            ):
                await merge_auth_user_into_user(
                    db,
                    source_user_id=current_user.id,
                    target_user_id=linked_user.id,
                )
                await attach_verified_identity(db, user=linked_user, verified=verified)
                return linked_user
            if current_readiness.product_ready and not linked_readiness.product_ready:
                await merge_auth_user_into_user(
                    db,
                    source_user_id=linked_user.id,
                    target_user_id=current_user.id,
                )
                await attach_verified_identity(db, user=current_user, verified=verified)
                return current_user
            raise HTTPException(status_code=409, detail="Provider identity already linked.")
        user = await get_user_by_id(db, challenge.user_id)
        if user is None:
            raise HTTPException(status_code=400, detail="User not found.")
        _ensure_active_user(user)
        await attach_verified_identity(db, user=user, verified=verified)
        return user

    if existing_identity is not None:
        user = await get_user_by_id(db, existing_identity.user_id)
        if user is None:
            raise HTTPException(status_code=400, detail="Linked user not found.")
        _ensure_active_user(user)
        await attach_verified_identity(db, user=user, verified=verified)
        return user

    email = _email_for_new_user(verified)
    if verified.provider == "github" and verified.email:
        existing_email_user = await get_user_by_email(db, verified.email)
        if existing_email_user is not None:
            _ensure_active_user(existing_email_user)
            await attach_verified_identity(db, user=existing_email_user, verified=verified)
            return existing_email_user
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
