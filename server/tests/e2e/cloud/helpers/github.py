from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import OAuthAccount
from proliferate.db.store import github_app as github_app_store
from proliferate.integrations.github import GitHubAppInstallationInfo
from proliferate.integrations.github.app_user_tokens import GitHubAppUserAuthorization
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


async def seed_github_app_repo_authority(
    db_session: AsyncSession,
    *,
    user_id: str,
    access_token: str,
    git_owner: str,
) -> None:
    """Seed a ready GitHub App user authorization + an ``all``-repos installation.

    On this branch the cloud repo surface (``save_cloud_environment`` ->
    ``require_github_cloud_repo_authority``) demands a GitHub App authorization
    and an installation for the repo's owner -- the plain linked-OAuth account
    that ``seed_linked_github_account`` writes is no longer sufficient (the old
    ``/repos/.../config`` endpoint that only needed the OAuth token was removed).

    This seeds the REAL ``gh`` token as the authorization's access token so the
    authority path stays a genuine end-to-end check: ``ensure_fresh_github_app_
    authorization`` returns it without a refresh (8h expiry), the live
    ``verify_github_app_user_repo_access`` GET /repos/{owner}/{repo} succeeds, and
    the sandbox's git-credential materialization clones with a token that truly
    has access. ``repository_selection='all'`` short-circuits the per-repo
    installation coverage fetch (which a non-app token could not serve).
    """
    now = datetime.now(UTC)
    await github_app_store.upsert_github_app_authorization(
        db_session,
        user_id=uuid.UUID(user_id),
        authorization=GitHubAppUserAuthorization(
            access_token=access_token,
            refresh_token=None,
            expires_at=now + timedelta(hours=8),
            refresh_token_expires_at=now + timedelta(days=180),
            github_user_id=f"github-user-{user_id[:8]}",
            github_login="workspace-move-e2e",
            permissions={},
        ),
    )
    await github_app_store.upsert_github_app_installation(
        db_session,
        installation=GitHubAppInstallationInfo(
            github_installation_id="142900805",
            account_login=git_owner,
            account_type="Organization",
            repository_selection="all",
            permissions={"contents": "read", "pull_requests": "write"},
            suspended_at=None,
        ),
    )
    await db_session.commit()
