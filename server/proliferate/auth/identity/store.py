"""Database access for canonical auth identity records."""

from __future__ import annotations

import json
import secrets
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.types import (
    REQUIRED_GITHUB_SCOPES,
    AccountReadiness,
    AuthChallengeSnapshot,
    AuthProviderGrantStatus,
    AuthProviderName,
    VerifiedProviderIdentity,
)
from proliferate.db.models.auth import (
    AuthChallenge,
    AuthIdentity,
    OAuthAccount,
    ProviderGrant,
    User,
)
from proliferate.utils.crypto import encrypt_text


def _now() -> datetime:
    return datetime.now(UTC)


def _scopes_json(scopes: frozenset[str]) -> str:
    return json.dumps(sorted(scopes), separators=(",", ":"))


def _parse_scopes(value: str | None) -> frozenset[str]:
    if not value:
        return frozenset()
    parsed = json.loads(value)
    if not isinstance(parsed, list):
        return frozenset()
    return frozenset(item for item in parsed if isinstance(item, str))


def _provider_grant_status(verified: VerifiedProviderIdentity) -> AuthProviderGrantStatus:
    if verified.expires_at is not None:
        expires_at = (
            verified.expires_at
            if verified.expires_at.tzinfo
            else verified.expires_at.replace(tzinfo=UTC)
        )
        if expires_at <= _now():
            return AuthProviderGrantStatus.EXPIRED
    if verified.provider == "github" and not REQUIRED_GITHUB_SCOPES.issubset(verified.scopes):
        return AuthProviderGrantStatus.NEEDS_REAUTH
    return AuthProviderGrantStatus.READY


def _legacy_expires_at(value: int | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromtimestamp(value, tz=UTC)


def _expires_at_is_past(value: datetime | None) -> bool:
    if value is None:
        return False
    expires_at = value if value.tzinfo else value.replace(tzinfo=UTC)
    return expires_at <= _now()


async def get_user_by_id(db: AsyncSession, user_id: UUID) -> User | None:
    return await db.get(User, user_id)


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def create_auth_user(
    db: AsyncSession,
    *,
    email: str,
    display_name: str | None,
    avatar_url: str | None,
) -> User:
    user = User(
        email=email,
        hashed_password=f"unused-oauth-only:{secrets.token_urlsafe(18)}",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name=display_name,
        avatar_url=avatar_url,
    )
    db.add(user)
    await db.flush()
    return user


async def get_identity_by_provider_subject(
    db: AsyncSession,
    *,
    provider: AuthProviderName,
    provider_subject: str,
) -> AuthIdentity | None:
    result = await db.execute(
        select(AuthIdentity).where(
            AuthIdentity.provider == provider,
            AuthIdentity.provider_subject == provider_subject,
        )
    )
    return result.scalar_one_or_none()


async def get_identity_for_user_provider(
    db: AsyncSession,
    *,
    user_id: UUID,
    provider: AuthProviderName,
) -> AuthIdentity | None:
    result = await db.execute(
        select(AuthIdentity)
        .where(
            AuthIdentity.user_id == user_id,
            AuthIdentity.provider == provider,
        )
        .order_by(AuthIdentity.linked_at.asc(), AuthIdentity.created_at.asc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def upsert_identity_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    verified: VerifiedProviderIdentity,
) -> AuthIdentity:
    identity = await get_identity_by_provider_subject(
        db,
        provider=verified.provider,
        provider_subject=verified.provider_subject,
    )
    if identity is not None and identity.user_id != user_id:
        raise ValueError("Provider identity is already linked to another user.")

    now = _now()
    if identity is None:
        identity = AuthIdentity(
            user_id=user_id,
            provider=verified.provider,
            provider_subject=verified.provider_subject,
            email=verified.email,
            email_verified=verified.email_verified,
            display_name=verified.display_name,
            avatar_url=verified.avatar_url,
            linked_at=now,
            last_login_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(identity)
    else:
        identity.provider_subject = verified.provider_subject
        identity.email = verified.email
        identity.email_verified = verified.email_verified
        identity.display_name = verified.display_name
        identity.avatar_url = verified.avatar_url
        identity.last_login_at = now
        identity.updated_at = now
    await db.flush()
    return identity


async def upsert_provider_grant(
    db: AsyncSession,
    *,
    identity: AuthIdentity,
    verified: VerifiedProviderIdentity,
) -> ProviderGrant | None:
    if verified.access_token is None:
        return None

    result = await db.execute(
        select(ProviderGrant).where(
            ProviderGrant.auth_identity_id == identity.id,
            ProviderGrant.provider == verified.provider,
        )
    )
    grant = result.scalar_one_or_none()
    now = _now()
    if grant is None:
        grant = ProviderGrant(
            user_id=identity.user_id,
            auth_identity_id=identity.id,
            provider=verified.provider,
            created_at=now,
            updated_at=now,
        )
        db.add(grant)

    grant.user_id = identity.user_id
    grant.access_token_ciphertext = encrypt_text(verified.access_token)
    grant.refresh_token_ciphertext = (
        encrypt_text(verified.refresh_token) if verified.refresh_token else None
    )
    grant.scopes_json = _scopes_json(verified.scopes)
    grant.expires_at = verified.expires_at
    grant.status = _provider_grant_status(verified).value
    grant.last_verified_at = now
    grant.updated_at = now
    await db.flush()
    return grant


async def mirror_legacy_oauth_account(
    db: AsyncSession,
    *,
    user_id: UUID,
    verified: VerifiedProviderIdentity,
) -> None:
    if verified.access_token is None:
        return

    result = await db.execute(
        select(OAuthAccount).where(
            OAuthAccount.oauth_name == verified.provider,
            OAuthAccount.account_id == verified.provider_subject,
        )
    )
    account = result.scalar_one_or_none()
    if account is None:
        account = OAuthAccount(
            user_id=user_id,
            oauth_name=verified.provider,
            access_token=verified.access_token,
            account_id=verified.provider_subject,
            account_email=verified.email or "",
            expires_at=verified.expires_at_timestamp,
            refresh_token=verified.refresh_token,
        )
        db.add(account)
    else:
        account.user_id = user_id
        account.access_token = verified.access_token
        account.account_email = verified.email or account.account_email
        account.expires_at = verified.expires_at_timestamp
        account.refresh_token = verified.refresh_token
    await db.flush()


async def get_provider_grant(
    db: AsyncSession,
    *,
    identity_id: UUID,
    provider: AuthProviderName,
) -> ProviderGrant | None:
    result = await db.execute(
        select(ProviderGrant).where(
            ProviderGrant.auth_identity_id == identity_id,
            ProviderGrant.provider == provider,
        )
    )
    return result.scalar_one_or_none()


async def get_account_readiness(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> AccountReadiness:
    await backfill_legacy_oauth_accounts_for_user(db, user_id=user_id)
    identity = await get_identity_for_user_provider(db, user_id=user_id, provider="github")
    if identity is None:
        return AccountReadiness(
            product_ready=False,
            missing_requirements=("github_identity_missing",),
            github_identity_id=None,
            github_grant_status=None,
        )

    grant = await get_provider_grant(db, identity_id=identity.id, provider="github")
    if grant is None:
        return AccountReadiness(
            product_ready=False,
            missing_requirements=("github_grant_missing",),
            github_identity_id=identity.id,
            github_grant_status=None,
        )

    if _expires_at_is_past(grant.expires_at):
        grant.status = AuthProviderGrantStatus.EXPIRED.value
        grant.updated_at = _now()
        await db.flush()

    missing: list[str] = []
    if grant.status != AuthProviderGrantStatus.READY.value:
        missing.append("github_grant_not_ready")
    scopes = _parse_scopes(grant.scopes_json)
    if REQUIRED_GITHUB_SCOPES and not REQUIRED_GITHUB_SCOPES.issubset(scopes):
        missing.append("github_scope_missing")

    return AccountReadiness(
        product_ready=not missing,
        missing_requirements=tuple(missing),
        github_identity_id=identity.id,
        github_grant_status=grant.status,
    )


async def create_auth_challenge(
    db: AsyncSession,
    *,
    provider: AuthProviderName,
    surface: str,
    purpose: str,
    state_hash: str,
    nonce_hash: str,
    csrf_hash: str | None,
    user_id: UUID | None,
    client_state: str,
    code_challenge: str,
    code_challenge_method: str,
    redirect_uri: str,
    expires_at: datetime,
) -> AuthChallenge:
    challenge = AuthChallenge(
        provider=provider,
        surface=surface,
        purpose=purpose,
        state_hash=state_hash,
        nonce_hash=nonce_hash,
        csrf_hash=csrf_hash,
        user_id=user_id,
        client_state=client_state,
        code_challenge=code_challenge,
        code_challenge_method=code_challenge_method,
        redirect_uri=redirect_uri,
        expires_at=expires_at,
        created_at=_now(),
    )
    db.add(challenge)
    await db.flush()
    return challenge


async def consume_auth_challenge(
    db: AsyncSession,
    *,
    state_hash: str,
) -> AuthChallengeSnapshot | None:
    result = await db.execute(
        select(AuthChallenge).where(
            AuthChallenge.state_hash == state_hash,
            AuthChallenge.consumed_at.is_(None),
        )
        .with_for_update()
    )
    challenge = result.scalar_one_or_none()
    if challenge is None:
        return None
    if challenge.expires_at.replace(tzinfo=challenge.expires_at.tzinfo or UTC) < _now():
        return None
    challenge.consumed_at = _now()
    await db.flush()
    return AuthChallengeSnapshot(
        id=challenge.id,
        provider=challenge.provider,  # type: ignore[arg-type]
        surface=challenge.surface,
        purpose=challenge.purpose,
        user_id=challenge.user_id,
        client_state=challenge.client_state,
        code_challenge=challenge.code_challenge,
        code_challenge_method=challenge.code_challenge_method,
        redirect_uri=challenge.redirect_uri,
        nonce_hash=challenge.nonce_hash,
    )


async def linked_provider_payloads(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[AuthIdentity]:
    await backfill_legacy_oauth_accounts_for_user(db, user_id=user_id)
    result = await db.execute(
        select(AuthIdentity)
        .where(AuthIdentity.user_id == user_id)
        .order_by(AuthIdentity.provider.asc(), AuthIdentity.linked_at.asc())
    )
    return list(result.scalars().all())


async def backfill_legacy_oauth_accounts_for_user(db: AsyncSession, *, user_id: UUID) -> None:
    result = await db.execute(
        select(OAuthAccount).where(
            OAuthAccount.user_id == user_id,
            OAuthAccount.oauth_name.in_(("github", "google")),
        )
        .with_for_update()
    )
    for account in result.scalars().all():
        provider = account.oauth_name
        if provider not in {"github", "google"}:
            continue
        existing_subject = await get_identity_by_provider_subject(
            db,
            provider=provider,  # type: ignore[arg-type]
            provider_subject=account.account_id,
        )
        if existing_subject is not None:
            continue
        # Legacy GitHub OAuth rows predate canonical grant scopes but were
        # created by our GitHub flow with the product-required scopes.
        scopes = frozenset(REQUIRED_GITHUB_SCOPES) if provider == "github" else frozenset()
        verified = VerifiedProviderIdentity(
            provider=provider,  # type: ignore[arg-type]
            provider_subject=account.account_id,
            email=account.account_email,
            email_verified=True,
            display_name=None,
            provider_login=None,
            avatar_url=None,
            access_token=account.access_token,
            refresh_token=account.refresh_token,
            expires_at=_legacy_expires_at(account.expires_at),
            expires_at_timestamp=account.expires_at,
            scopes=scopes,
        )
        identity = await upsert_identity_for_user(db, user_id=user_id, verified=verified)
        await upsert_provider_grant(db, identity=identity, verified=verified)
