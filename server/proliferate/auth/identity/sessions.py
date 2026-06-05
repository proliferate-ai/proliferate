"""Session and viewer payload helpers for product auth."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException
from fastapi_users.jwt import decode_jwt, generate_jwt
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity import providers
from proliferate.auth.identity.models import AccountReadinessResponse, AuthSessionResponse
from proliferate.auth.identity.password import auth_password_credential
from proliferate.auth.identity.store import (
    get_account_readiness,
    get_user_by_id,
    linked_provider_payloads,
)
from proliferate.auth.identity.types import AUTH_PROVIDERS, AccountReadiness, AuthSession
from proliferate.auth.jwt import get_jwt_strategy
from proliferate.auth.models import (
    AuthLinkedProvider,
    AuthPasswordCredential,
    AuthProviderAvailability,
    UserRead,
)
from proliferate.auth.pkce import verify_pkce
from proliferate.config import settings
from proliferate.constants.auth import (
    AUTH_CODE_LIFETIME_SECONDS,
    JWT_LIFETIME_SECONDS,
    REFRESH_TOKEN_LIFETIME_SECONDS,
)
from proliferate.db.models.auth import User
from proliferate.db.store.auth import consume_auth_code

WEB_REFRESH_COOKIE = "proliferate_web_refresh"
WEB_CSRF_COOKIE = "proliferate_web_csrf"
WEB_CSRF_HEADER = "x-proliferate-csrf"


def _ensure_active_user(user: User) -> None:
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is inactive.")


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
    _ensure_active_user(user)
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
        is_active=user.is_active,
        is_superuser=user.is_superuser,
        is_verified=user.is_verified,
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
) -> tuple[
    bool,
    str,
    list[AuthLinkedProvider],
    list[AuthProviderAvailability],
    AuthPasswordCredential,
]:
    readiness = await get_account_readiness(db, user_id=user.id)
    identities = await linked_provider_payloads(db, user_id=user.id)
    linked = [
        AuthLinkedProvider(
            provider=identity.provider,  # type: ignore[arg-type]
            connected=True,
            account_email=identity.email,
            account_id=identity.provider_subject,
        )
        for identity in identities
    ]
    connected_providers = {identity.provider for identity in identities}
    linked.extend(
        AuthLinkedProvider(
            provider=provider,
            connected=False,
            account_email=None,
            account_id=None,
        )
        for provider in AUTH_PROVIDERS
        if provider not in connected_providers
    )
    availability = [
        AuthProviderAvailability(
            provider=provider,  # type: ignore[arg-type]
            enabled=providers.provider_enabled(provider, surface="web"),  # type: ignore[arg-type]
            reason=(
                None if providers.provider_enabled(provider, surface="web") else "not_configured"
            ),
        )
        for provider in ("github", "google", "apple")
    ]
    return (
        readiness.product_ready,
        "active" if readiness.product_ready else "needs_github",
        linked,
        availability,
        auth_password_credential(user),
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
            is_active=session.is_active,
            is_superuser=session.is_superuser,
            is_verified=session.is_verified,
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
