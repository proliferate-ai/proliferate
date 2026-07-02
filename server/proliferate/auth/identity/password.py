"""Password sign-in helpers for product auth."""

from __future__ import annotations

import hashlib
import hmac
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.models import PasswordCredentialResponse
from proliferate.auth.identity.types import AuthSession
from proliferate.auth.models import AuthPasswordCredential
from proliferate.auth.passwords import (
    PasswordValidationError,
    harden_password_failure,
    hash_password,
    normalize_password_email,
    validate_new_password,
    verify_password,
)
from proliferate.config import settings
from proliferate.constants.auth import PASSWORD_LOGIN_EMAIL_BUCKET, PASSWORD_LOGIN_IP_BUCKET
from proliferate.db.models.auth import User
from proliferate.db.store.auth_passwords import (
    PasswordLoginBucket,
    active_password_login_blocks,
    clear_password_login_failures,
    get_user_by_normalized_email,
    record_password_login_failure,
    update_user_password_hash,
)
from proliferate.server.organizations.admin_emails import ensure_admin_email_role

PASSWORD_BAD_CREDENTIALS_MESSAGE = "Email or password is incorrect."
PASSWORD_RATE_LIMIT_MESSAGE = "Too many attempts. Wait a moment, then try again."


def hash_password_login_bucket(kind: str, value: str) -> str:
    return hmac.new(
        settings.jwt_secret.encode(),
        f"{kind}:{value}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _ensure_password_auth_enabled() -> None:
    if not settings.password_auth_enabled:
        raise HTTPException(status_code=404, detail="Email sign-in is not enabled.")


def password_login_buckets(
    *,
    email: str,
    client_ip: str | None,
) -> tuple[PasswordLoginBucket, ...]:
    normalized_email = normalize_password_email(email)
    buckets = [
        PasswordLoginBucket(
            kind=PASSWORD_LOGIN_EMAIL_BUCKET,
            key=hash_password_login_bucket(PASSWORD_LOGIN_EMAIL_BUCKET, normalized_email),
        )
    ]
    if client_ip:
        normalized_ip = client_ip.strip().lower()
        buckets.append(
            PasswordLoginBucket(
                kind=PASSWORD_LOGIN_IP_BUCKET,
                key=hash_password_login_bucket(PASSWORD_LOGIN_IP_BUCKET, normalized_ip),
            )
        )
    return tuple(buckets)


async def authenticate_password_login(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    client_ip: str | None,
) -> AuthSession:
    _ensure_password_auth_enabled()
    normalized_email = normalize_password_email(email)
    buckets = password_login_buckets(email=normalized_email, client_ip=client_ip)
    now = datetime.now(UTC)
    if await active_password_login_blocks(db, buckets=buckets, now=now):
        raise HTTPException(status_code=429, detail=PASSWORD_RATE_LIMIT_MESSAGE)

    user = await get_user_by_normalized_email(db, normalized_email)
    if user is None or not user.is_active or user.password_set_at is None:
        harden_password_failure(password)
        await record_password_login_failure(db, buckets=buckets, now=now)
        raise HTTPException(status_code=401, detail=PASSWORD_BAD_CREDENTIALS_MESSAGE)

    verification = verify_password(password, user.hashed_password)
    if not verification.verified:
        await record_password_login_failure(db, buckets=buckets, now=now)
        raise HTTPException(status_code=401, detail=PASSWORD_BAD_CREDENTIALS_MESSAGE)

    if verification.updated_hash is not None:
        updated = await update_user_password_hash(
            db,
            user_id=user.id,
            hashed_password=verification.updated_hash,
            password_set_at=_aware_password_set_at(user.password_set_at),
        )
        if updated is not None:
            user = updated
    await clear_password_login_failures(
        db,
        buckets=password_login_buckets(email=normalized_email, client_ip=None),
    )
    # ADMIN_EMAILS floor: asserted at every login, not just account creation.
    await ensure_admin_email_role(db, user)
    from proliferate.auth.identity.sessions import mint_auth_session

    return await mint_auth_session(db, user=user)


async def set_password_credential(
    db: AsyncSession,
    *,
    user: User,
    current_password: str | None,
    new_password: str,
) -> PasswordCredentialResponse:
    _ensure_password_auth_enabled()
    if user.password_set_at is not None:
        if not current_password:
            raise HTTPException(status_code=400, detail="Current password is required.")
        verification = verify_password(current_password, user.hashed_password)
        if not verification.verified:
            raise HTTPException(status_code=401, detail="Current password is incorrect.")

    try:
        validate_new_password(new_password)
    except PasswordValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.reason) from exc

    now = datetime.now(UTC)
    updated_user = await update_user_password_hash(
        db,
        user_id=user.id,
        hashed_password=hash_password(new_password),
        password_set_at=now,
    )
    if updated_user is None:
        raise HTTPException(status_code=400, detail="User not found.")
    return password_credential_response(updated_user)


def password_credential_response(user: User) -> PasswordCredentialResponse:
    set_at = _password_set_at_iso(user.password_set_at)
    return PasswordCredentialResponse(enabled=set_at is not None, set_at=set_at)


def auth_password_credential(user: User) -> AuthPasswordCredential:
    set_at = _password_set_at_iso(user.password_set_at)
    return AuthPasswordCredential(enabled=set_at is not None, set_at=set_at)


def _password_set_at_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return _aware_password_set_at(value).isoformat()


def _aware_password_set_at(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)
