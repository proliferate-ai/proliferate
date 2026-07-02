from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.auth import OAuthAccount
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import github_app as github_app_store
from proliferate.integrations.github import GitHubAppInstallationInfo
from proliferate.integrations.github.app_user_tokens import GitHubAppUserAuthorization
from proliferate.server.cloud.github_app import repo_authority
from tests.helpers.desktop_auth import mint_desktop_token_payload


async def register_and_login(
    client: AsyncClient,
    email: str,
    *,
    link_github: bool = True,
) -> dict[str, str]:
    """Create a user via the user manager and obtain tokens via PKCE."""
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager
    from proliferate.db.engine import get_async_session
    from proliferate.auth.users import get_user_db

    user_id: str | None = None
    async for session in get_async_session():
        async for user_db in get_user_db(session):
            manager = UserManager(user_db)
            user = await manager.create(
                UserCreate(email=email, password="unused-oauth-only", display_name="Cloud Tester"),
            )
            if link_github:
                session.add(
                    OAuthAccount(
                        user_id=user.id,
                        oauth_name="github",
                        access_token="github-access-token",
                        account_id=f"github-{user.id}",
                        account_email=email,
                    )
                )
            await session.commit()
            user_id = str(user.id)

    assert user_id is not None

    token_data = await mint_desktop_token_payload(
        client,
        user_id=user_id,
        state_prefix="cloud-state",
    )
    return {
        "user_id": user_id,
        "access_token": str(token_data["access_token"]),
    }


async def link_github_account(db_session: AsyncSession, user_id: str) -> None:
    existing = (
        await db_session.execute(
            select(OAuthAccount).where(
                OAuthAccount.user_id == uuid.UUID(user_id),
                OAuthAccount.oauth_name == "github",
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.access_token = "github-access-token"
        existing.account_id = "12345"
        existing.account_email = "cloud@example.com"
        await db_session.commit()
        return

    account = OAuthAccount(
        user_id=uuid.UUID(user_id),
        oauth_name="github",
        access_token="github-access-token",
        account_id="12345",
        account_email="cloud@example.com",
    )
    db_session.add(account)
    await db_session.commit()


async def seed_github_app_repo_authority(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    *,
    user_id: str,
    git_owner: str = "proliferate-ai",
) -> None:
    await github_app_store.upsert_github_app_authorization(
        db_session,
        user_id=uuid.UUID(user_id),
        authorization=GitHubAppUserAuthorization(
            access_token="github-app-user-token",
            refresh_token="github-app-refresh-token",
            expires_at=datetime.now(UTC) + timedelta(hours=8),
            refresh_token_expires_at=datetime.now(UTC) + timedelta(days=180),
            github_user_id="12345",
            github_login="cloud-tester",
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

    async def _has_access(**_kwargs) -> bool:  # type: ignore[no-untyped-def]
        return True

    monkeypatch.setattr(repo_authority, "verify_github_app_user_repo_access", _has_access)


async def create_organization_for_user(db_session: AsyncSession, user_id: str) -> str:
    now = datetime.now(UTC)
    organization = Organization(
        name="Cloud Test Team",
        status=ORGANIZATION_STATUS_ACTIVE,
        created_at=now,
        updated_at=now,
    )
    db_session.add(organization)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=uuid.UUID(user_id),
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db_session.commit()
    return str(organization.id)


async def add_organization_member(
    db_session: AsyncSession,
    *,
    organization_id: str,
    user_id: str,
    role: str = ORGANIZATION_ROLE_MEMBER,
) -> None:
    now = datetime.now(UTC)
    db_session.add(
        OrganizationMembership(
            organization_id=uuid.UUID(organization_id),
            user_id=uuid.UUID(user_id),
            role=role,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db_session.commit()
