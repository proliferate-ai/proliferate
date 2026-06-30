"""GitHub App authorization and installation cache persistence."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.github_app import (
    GitHubAppAuthorization,
    GitHubAppInstallation,
    GitHubAppInstallationRepository,
)
from proliferate.utils.crypto import decrypt_text, encrypt_text
from proliferate.utils.time import utcnow

_CACHE_FRESHNESS_SECONDS = 600


@dataclass(frozen=True, repr=False)
class GitHubAppAuthorizationValue:
    id: UUID
    user_id: UUID
    github_user_id: str
    github_login: str
    access_token: str | None
    refresh_token: str | None
    token_expires_at: datetime | None
    refresh_token_expires_at: datetime | None
    status: str
    permissions: dict[str, object]
    revoked_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class GitHubAppInstallationValue:
    id: UUID
    organization_id: UUID | None
    installed_by_user_id: UUID | None
    github_installation_id: str
    account_login: str
    account_type: str
    repository_selection: str
    permissions: dict[str, object]
    suspended_at: datetime | None
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class GitHubAppInstallationRepositoryValue:
    id: UUID
    github_app_installation_id: UUID
    owner: str
    name: str
    github_repository_id: str
    private: bool
    default_branch: str | None
    updated_at: datetime


class GitHubAppUserAuthorizationPayload(Protocol):
    access_token: str
    refresh_token: str | None
    expires_at: datetime | None
    refresh_token_expires_at: datetime | None
    github_user_id: str
    github_login: str
    permissions: dict[str, object]


class GitHubAppInstallationPayload(Protocol):
    github_installation_id: str
    account_login: str
    account_type: str
    repository_selection: str
    permissions: dict[str, object]
    suspended_at: datetime | None


class GitHubAppRepositoryCoveragePayload(Protocol):
    covered: bool
    repository_id: str | None
    private: bool | None
    default_branch: str | None


def _parse_json_object(value: str | None) -> dict[str, object]:
    if not value:
        return {}
    parsed = json.loads(value)
    return parsed if isinstance(parsed, dict) else {}


def _authorization_value(row: GitHubAppAuthorization) -> GitHubAppAuthorizationValue:
    return GitHubAppAuthorizationValue(
        id=row.id,
        user_id=row.user_id,
        github_user_id=row.github_user_id,
        github_login=row.github_login,
        access_token=decrypt_text(row.access_token_ciphertext)
        if row.access_token_ciphertext
        else None,
        refresh_token=decrypt_text(row.refresh_token_ciphertext)
        if row.refresh_token_ciphertext
        else None,
        token_expires_at=row.token_expires_at,
        refresh_token_expires_at=row.refresh_token_expires_at,
        status=row.status,
        permissions=_parse_json_object(row.permissions_json),
        revoked_at=row.revoked_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _installation_value(row: GitHubAppInstallation) -> GitHubAppInstallationValue:
    return GitHubAppInstallationValue(
        id=row.id,
        organization_id=row.organization_id,
        installed_by_user_id=row.installed_by_user_id,
        github_installation_id=row.github_installation_id,
        account_login=row.account_login,
        account_type=row.account_type,
        repository_selection=row.repository_selection,
        permissions=_parse_json_object(row.permissions_json),
        suspended_at=row.suspended_at,
        deleted_at=row.deleted_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _repo_value(
    row: GitHubAppInstallationRepository,
) -> GitHubAppInstallationRepositoryValue:
    return GitHubAppInstallationRepositoryValue(
        id=row.id,
        github_app_installation_id=row.github_app_installation_id,
        owner=row.owner,
        name=row.name,
        github_repository_id=row.github_repository_id,
        private=row.private,
        default_branch=row.default_branch,
        updated_at=row.updated_at,
    )


async def get_github_app_authorization_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    lock_row: bool = False,
) -> GitHubAppAuthorizationValue | None:
    statement = select(GitHubAppAuthorization).where(
        GitHubAppAuthorization.user_id == user_id,
        GitHubAppAuthorization.status != "revoked",
    )
    if lock_row:
        statement = statement.with_for_update()
    row = (await db.execute(statement)).scalar_one_or_none()
    return _authorization_value(row) if row is not None else None


async def upsert_github_app_authorization(
    db: AsyncSession,
    *,
    user_id: UUID,
    authorization: GitHubAppUserAuthorizationPayload,
) -> GitHubAppAuthorizationValue:
    now = utcnow()
    row = (
        await db.execute(
            select(GitHubAppAuthorization)
            .where(
                GitHubAppAuthorization.user_id == user_id,
                GitHubAppAuthorization.status != "revoked",
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        row = GitHubAppAuthorization(
            user_id=user_id,
            github_user_id=authorization.github_user_id,
            github_login=authorization.github_login,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    row.github_user_id = authorization.github_user_id
    row.github_login = authorization.github_login
    row.access_token_ciphertext = encrypt_text(authorization.access_token)
    row.refresh_token_ciphertext = (
        encrypt_text(authorization.refresh_token) if authorization.refresh_token else None
    )
    row.token_expires_at = authorization.expires_at
    row.refresh_token_expires_at = authorization.refresh_token_expires_at
    row.status = "ready"
    row.permissions_json = json.dumps(authorization.permissions, separators=(",", ":"))
    row.revoked_at = None
    row.updated_at = now
    await db.flush()
    return _authorization_value(row)


async def mark_github_app_authorization_needs_reauth(
    db: AsyncSession,
    authorization_id: UUID,
) -> None:
    row = await db.get(GitHubAppAuthorization, authorization_id)
    if row is None:
        return
    row.status = "needs_reauth"
    row.updated_at = utcnow()
    await db.flush()


async def upsert_github_app_installation(
    db: AsyncSession,
    *,
    installation: GitHubAppInstallationPayload,
    organization_id: UUID | None = None,
    installed_by_user_id: UUID | None = None,
) -> GitHubAppInstallationValue:
    now = utcnow()
    row = (
        await db.execute(
            select(GitHubAppInstallation)
            .where(
                GitHubAppInstallation.github_installation_id
                == installation.github_installation_id
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        row = GitHubAppInstallation(
            github_installation_id=installation.github_installation_id,
            account_login=installation.account_login,
            account_type=installation.account_type,
            repository_selection=installation.repository_selection,
            permissions_json=json.dumps(installation.permissions, separators=(",", ":")),
            suspended_at=installation.suspended_at,
            deleted_at=None,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    row.account_login = installation.account_login
    row.account_type = installation.account_type
    row.repository_selection = installation.repository_selection
    row.permissions_json = json.dumps(installation.permissions, separators=(",", ":"))
    row.suspended_at = installation.suspended_at
    row.deleted_at = None
    if organization_id is not None:
        row.organization_id = organization_id
    if installed_by_user_id is not None:
        row.installed_by_user_id = installed_by_user_id
    row.updated_at = now
    await db.flush()
    return _installation_value(row)


async def get_github_app_installation_for_organization(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> GitHubAppInstallationValue | None:
    row = (
        await db.execute(
            select(GitHubAppInstallation)
            .where(GitHubAppInstallation.organization_id == organization_id)
            .where(GitHubAppInstallation.deleted_at.is_(None))
            .order_by(GitHubAppInstallation.updated_at.desc())
        )
    ).scalars().first()
    return _installation_value(row) if row is not None else None


async def mark_github_app_installation_deleted(
    db: AsyncSession,
    *,
    github_installation_id: str,
) -> None:
    row = (
        await db.execute(
            select(GitHubAppInstallation).where(
                GitHubAppInstallation.github_installation_id == github_installation_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return
    row.deleted_at = utcnow()
    row.updated_at = utcnow()
    await db.execute(
        delete(GitHubAppInstallationRepository).where(
            GitHubAppInstallationRepository.github_app_installation_id == row.id
        )
    )
    await db.flush()


async def set_github_app_installation_suspended(
    db: AsyncSession,
    *,
    github_installation_id: str,
    suspended_at: datetime | None,
) -> None:
    row = (
        await db.execute(
            select(GitHubAppInstallation).where(
                GitHubAppInstallation.github_installation_id == github_installation_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return
    row.suspended_at = suspended_at
    row.updated_at = utcnow()
    await db.flush()


async def list_active_github_app_installations_for_owner(
    db: AsyncSession,
    *,
    owner: str,
) -> tuple[GitHubAppInstallationValue, ...]:
    rows = (
        await db.execute(
            select(GitHubAppInstallation)
            .where(func.lower(GitHubAppInstallation.account_login) == owner.lower())
            .where(GitHubAppInstallation.deleted_at.is_(None))
            .where(GitHubAppInstallation.suspended_at.is_(None))
            .order_by(GitHubAppInstallation.updated_at.desc())
        )
    ).scalars()
    return tuple(_installation_value(row) for row in rows)


async def get_fresh_installation_repo_cache(
    db: AsyncSession,
    *,
    installation_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> GitHubAppInstallationRepositoryValue | None:
    threshold = utcnow() - timedelta(seconds=_CACHE_FRESHNESS_SECONDS)
    row = (
        await db.execute(
            select(GitHubAppInstallationRepository)
            .where(GitHubAppInstallationRepository.github_app_installation_id == installation_id)
            .where(func.lower(GitHubAppInstallationRepository.owner) == git_owner.lower())
            .where(func.lower(GitHubAppInstallationRepository.name) == git_repo_name.lower())
            .where(GitHubAppInstallationRepository.updated_at >= threshold)
        )
    ).scalar_one_or_none()
    return _repo_value(row) if row is not None else None


async def upsert_installation_repo_cache(
    db: AsyncSession,
    *,
    installation_id: UUID,
    owner: str,
    name: str,
    coverage: GitHubAppRepositoryCoveragePayload,
) -> None:
    if not coverage.covered or coverage.repository_id is None:
        await delete_installation_repo_cache(
            db,
            installation_id=installation_id,
            owner=owner,
            name=name,
        )
        return
    now = utcnow()
    await db.execute(
        pg_insert(GitHubAppInstallationRepository)
        .values(
            github_app_installation_id=installation_id,
            owner=owner,
            name=name,
            github_repository_id=coverage.repository_id,
            private=coverage.private is not False,
            default_branch=coverage.default_branch,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[
                GitHubAppInstallationRepository.github_app_installation_id,
                GitHubAppInstallationRepository.owner,
                GitHubAppInstallationRepository.name,
            ],
            set_={
                "github_repository_id": coverage.repository_id,
                "private": coverage.private is not False,
                "default_branch": coverage.default_branch,
                "updated_at": now,
            },
        )
    )
    await db.flush()


async def delete_installation_repo_cache(
    db: AsyncSession,
    *,
    installation_id: UUID,
    owner: str,
    name: str,
) -> None:
    await db.execute(
        delete(GitHubAppInstallationRepository)
        .where(GitHubAppInstallationRepository.github_app_installation_id == installation_id)
        .where(func.lower(GitHubAppInstallationRepository.owner) == owner.lower())
        .where(func.lower(GitHubAppInstallationRepository.name) == name.lower())
    )
    await db.flush()
