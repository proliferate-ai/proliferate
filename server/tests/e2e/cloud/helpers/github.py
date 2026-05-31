from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import OAuthAccount
from proliferate.auth.identity.store import upsert_identity_for_user, upsert_provider_grant
from proliferate.auth.identity.types import REQUIRED_GITHUB_SCOPES, VerifiedProviderIdentity


async def seed_linked_github_account(
    db_session: AsyncSession,
    *,
    user_id: str,
    access_token: str,
    account_id: str | None = None,
    account_email: str | None = None,
) -> None:
    user_uuid = uuid.UUID(user_id)
    resolved_account_id = account_id or f"github-{user_id}"
    resolved_account_email = account_email or f"cloud-e2e-{uuid.uuid4().hex[:8]}@example.com"
    account = (
        await db_session.execute(
            select(OAuthAccount)
            .where(
                OAuthAccount.user_id == user_uuid,
                OAuthAccount.oauth_name == "github",
            )
            .order_by(OAuthAccount.id.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if account is None:
        account = OAuthAccount(user_id=user_uuid, oauth_name="github")
        db_session.add(account)
    account.access_token = access_token
    account.account_id = resolved_account_id
    account.account_email = resolved_account_email

    verified = VerifiedProviderIdentity(
        provider="github",
        provider_subject=resolved_account_id,
        email=resolved_account_email,
        email_verified=True,
        display_name=None,
        provider_login=None,
        avatar_url=None,
        access_token=access_token,
        refresh_token=None,
        expires_at=None,
        expires_at_timestamp=None,
        scopes=frozenset(REQUIRED_GITHUB_SCOPES),
    )
    identity = await upsert_identity_for_user(db_session, user_id=user_uuid, verified=verified)
    await upsert_provider_grant(db_session, identity=identity, verified=verified)
    await db_session.commit()


async def link_github_account(
    db_session: AsyncSession,
    *,
    user_id: str,
    access_token: str,
) -> None:
    await seed_linked_github_account(
        db_session,
        user_id=user_id,
        access_token=access_token,
    )
