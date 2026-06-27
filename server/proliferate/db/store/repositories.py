"""Persistence helpers for logical repositories and repo environments."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.repo_config import CloudRepoConfig
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class RepoEnvironmentValue:
    id: UUID
    repo_config_id: UUID
    owner_scope: str
    user_id: UUID | None
    organization_id: UUID | None
    git_provider: str
    git_owner: str
    git_repo_name: str
    environment_kind: str
    desktop_install_id: str | None
    local_path: str | None
    configured: bool
    configured_at: datetime | None
    default_branch: str | None
    setup_script: str
    setup_script_version: int
    run_command: str
    config_version: int
    legacy_cloud_repo_config_id: UUID | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class RepoConfigValue:
    id: UUID
    owner_scope: str
    user_id: UUID | None
    organization_id: UUID | None
    git_provider: str
    git_owner: str
    git_repo_name: str
    legacy_cloud_repo_config_id: UUID | None
    created_at: datetime
    updated_at: datetime
    environments: tuple[RepoEnvironmentValue, ...]


def _environment_value(row: RepoEnvironment, repo: RepoConfig) -> RepoEnvironmentValue:
    return RepoEnvironmentValue(
        id=row.id,
        repo_config_id=row.repo_config_id,
        owner_scope=repo.owner_scope,
        user_id=repo.user_id,
        organization_id=repo.organization_id,
        git_provider=repo.git_provider,
        git_owner=repo.git_owner,
        git_repo_name=repo.git_repo_name,
        environment_kind=row.environment_kind,
        desktop_install_id=row.desktop_install_id,
        local_path=row.local_path,
        configured=row.configured,
        configured_at=row.configured_at,
        default_branch=row.default_branch,
        setup_script=row.setup_script,
        setup_script_version=row.setup_script_version,
        run_command=row.run_command,
        config_version=row.config_version,
        legacy_cloud_repo_config_id=row.legacy_cloud_repo_config_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _repo_value(db: AsyncSession, row: RepoConfig) -> RepoConfigValue:
    environments = list(
        (
            await db.execute(
                select(RepoEnvironment)
                .where(RepoEnvironment.repo_config_id == row.id)
                .where(RepoEnvironment.deleted_at.is_(None))
                .order_by(RepoEnvironment.environment_kind.asc(), RepoEnvironment.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return RepoConfigValue(
        id=row.id,
        owner_scope=row.owner_scope,
        user_id=row.user_id,
        organization_id=row.organization_id,
        git_provider=row.git_provider,
        git_owner=row.git_owner,
        git_repo_name=row.git_repo_name,
        legacy_cloud_repo_config_id=row.legacy_cloud_repo_config_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        environments=tuple(_environment_value(item, row) for item in environments),
    )


async def get_repo_config_for_owner(
    db: AsyncSession,
    *,
    owner_scope: str,
    user_id: UUID | None,
    organization_id: UUID | None,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
) -> RepoConfigValue | None:
    row = (
        await db.execute(
            select(RepoConfig).where(
                RepoConfig.owner_scope == owner_scope,
                RepoConfig.user_id == user_id,
                RepoConfig.organization_id == organization_id,
                RepoConfig.git_provider == git_provider,
                RepoConfig.git_owner == git_owner,
                RepoConfig.git_repo_name == git_repo_name,
                RepoConfig.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    return await _repo_value(db, row) if row is not None else None


async def get_cloud_repo_environment(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> RepoEnvironmentValue | None:
    row = (
        await db.execute(
            select(RepoEnvironment, RepoConfig)
            .join(RepoConfig, RepoEnvironment.repo_config_id == RepoConfig.id)
            .where(
                RepoConfig.owner_scope == "personal",
                RepoConfig.user_id == user_id,
                RepoConfig.git_provider == "github",
                RepoConfig.git_owner == git_owner,
                RepoConfig.git_repo_name == git_repo_name,
                RepoConfig.deleted_at.is_(None),
                RepoEnvironment.environment_kind == "cloud",
                RepoEnvironment.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    if row is None:
        return None
    environment, repo = row
    return _environment_value(environment, repo)


async def list_cloud_repo_environments(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[RepoEnvironmentValue, ...]:
    rows = (
        await db.execute(
            select(RepoEnvironment, RepoConfig)
            .join(RepoConfig, RepoEnvironment.repo_config_id == RepoConfig.id)
            .where(
                RepoConfig.owner_scope == "personal",
                RepoConfig.user_id == user_id,
                RepoConfig.deleted_at.is_(None),
                RepoEnvironment.environment_kind == "cloud",
                RepoEnvironment.deleted_at.is_(None),
            )
            .order_by(RepoConfig.git_owner.asc(), RepoConfig.git_repo_name.asc())
        )
    ).all()
    return tuple(_environment_value(environment, repo) for environment, repo in rows)


async def list_repo_configs_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[RepoConfigValue, ...]:
    rows = list(
        (
            await db.execute(
                select(RepoConfig)
                .where(
                    RepoConfig.owner_scope == "personal",
                    RepoConfig.user_id == user_id,
                    RepoConfig.deleted_at.is_(None),
                )
                .order_by(RepoConfig.git_owner.asc(), RepoConfig.git_repo_name.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple([await _repo_value(db, row) for row in rows])


async def upsert_local_repo_environment(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    desktop_install_id: str,
    local_path: str,
    default_branch: str | None,
    setup_script: str,
    run_command: str,
) -> RepoEnvironmentValue:
    now = utcnow()
    repo = (
        await db.execute(
            select(RepoConfig).where(
                RepoConfig.owner_scope == "personal",
                RepoConfig.user_id == user_id,
                RepoConfig.organization_id.is_(None),
                RepoConfig.git_provider == git_provider,
                RepoConfig.git_owner == git_owner,
                RepoConfig.git_repo_name == git_repo_name,
                RepoConfig.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if repo is None:
        repo = RepoConfig(
            owner_scope="personal",
            user_id=user_id,
            organization_id=None,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            legacy_cloud_repo_config_id=None,
            created_at=now,
            updated_at=now,
            deleted_at=None,
        )
        db.add(repo)
        await db.flush()

    environment = (
        await db.execute(
            select(RepoEnvironment).where(
                RepoEnvironment.repo_config_id == repo.id,
                RepoEnvironment.environment_kind == "local",
                RepoEnvironment.desktop_install_id == desktop_install_id,
                RepoEnvironment.local_path == local_path,
                RepoEnvironment.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    normalized_default_branch = default_branch.strip() if default_branch and default_branch.strip() else None
    if environment is None:
        environment = RepoEnvironment(
            repo_config_id=repo.id,
            environment_kind="local",
            desktop_install_id=desktop_install_id,
            local_path=local_path,
            configured=True,
            configured_at=now,
            default_branch=normalized_default_branch,
            setup_script=setup_script,
            setup_script_version=1 if setup_script.strip() else 0,
            run_command=run_command,
            config_version=1,
            legacy_cloud_repo_config_id=None,
            created_at=now,
            updated_at=now,
            deleted_at=None,
        )
        db.add(environment)
    else:
        setup_changed = environment.setup_script != setup_script
        config_changed = (
            setup_changed
            or environment.run_command != run_command
            or environment.default_branch != normalized_default_branch
            or not environment.configured
        )
        environment.configured = True
        environment.configured_at = environment.configured_at or now
        environment.default_branch = normalized_default_branch
        environment.setup_script = setup_script
        if setup_changed:
            environment.setup_script_version += 1
        environment.run_command = run_command
        if config_changed:
            environment.config_version += 1
        environment.updated_at = now
    repo.updated_at = now
    await db.flush()
    return _environment_value(environment, repo)


async def sync_cloud_environment_from_legacy_cloud_repo_config(
    db: AsyncSession,
    *,
    cloud_repo_config_id: UUID,
) -> RepoEnvironmentValue | None:
    legacy = await db.get(CloudRepoConfig, cloud_repo_config_id)
    if legacy is None:
        return None

    now = utcnow()
    repo = await db.get(RepoConfig, legacy.id)
    if repo is None:
        repo = (
            await db.execute(
                select(RepoConfig).where(
                    RepoConfig.owner_scope == legacy.owner_scope,
                    RepoConfig.user_id == legacy.user_id,
                    RepoConfig.organization_id == legacy.organization_id,
                    RepoConfig.git_provider == "github",
                    RepoConfig.git_owner == legacy.git_owner,
                    RepoConfig.git_repo_name == legacy.git_repo_name,
                    RepoConfig.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()

    if repo is None:
        repo = RepoConfig(
            id=legacy.id,
            owner_scope=legacy.owner_scope,
            user_id=legacy.user_id,
            organization_id=legacy.organization_id,
            git_provider="github",
            git_owner=legacy.git_owner,
            git_repo_name=legacy.git_repo_name,
            legacy_cloud_repo_config_id=legacy.id,
            created_at=legacy.created_at,
            updated_at=legacy.updated_at,
            deleted_at=None,
        )
        db.add(repo)
        await db.flush()
    else:
        repo.owner_scope = legacy.owner_scope
        repo.user_id = legacy.user_id
        repo.organization_id = legacy.organization_id
        repo.git_provider = "github"
        repo.git_owner = legacy.git_owner
        repo.git_repo_name = legacy.git_repo_name
        repo.legacy_cloud_repo_config_id = legacy.id
        repo.updated_at = now

    environment = await db.get(RepoEnvironment, legacy.id)
    if environment is None:
        environment = (
            await db.execute(
                select(RepoEnvironment).where(
                    RepoEnvironment.legacy_cloud_repo_config_id == legacy.id
                )
            )
        ).scalar_one_or_none()

    legacy_config_version = max(
        legacy.files_version,
        legacy.env_vars_version,
        legacy.setup_script_version,
        1 if legacy.configured else 0,
    )
    if environment is None:
        environment = RepoEnvironment(
            id=legacy.id,
            repo_config_id=repo.id,
            environment_kind="cloud",
            desktop_install_id=None,
            local_path=None,
            configured=legacy.configured,
            configured_at=legacy.configured_at,
            default_branch=legacy.default_branch,
            setup_script=legacy.setup_script,
            setup_script_version=legacy.setup_script_version,
            run_command=legacy.run_command,
            config_version=legacy_config_version,
            legacy_cloud_repo_config_id=legacy.id,
            created_at=legacy.created_at,
            updated_at=legacy.updated_at,
            deleted_at=None,
        )
        db.add(environment)
    else:
        environment_changed = (
            environment.configured != legacy.configured
            or environment.configured_at != legacy.configured_at
            or environment.default_branch != legacy.default_branch
            or environment.setup_script != legacy.setup_script
            or environment.setup_script_version != legacy.setup_script_version
            or environment.run_command != legacy.run_command
            or environment.legacy_cloud_repo_config_id != legacy.id
            or environment.deleted_at is not None
        )
        environment.repo_config_id = repo.id
        environment.environment_kind = "cloud"
        environment.desktop_install_id = None
        environment.local_path = None
        environment.configured = legacy.configured
        environment.configured_at = legacy.configured_at
        environment.default_branch = legacy.default_branch
        environment.setup_script = legacy.setup_script
        environment.setup_script_version = legacy.setup_script_version
        environment.run_command = legacy.run_command
        environment.config_version = max(
            legacy_config_version,
            environment.config_version + 1 if environment_changed else environment.config_version,
        )
        environment.legacy_cloud_repo_config_id = legacy.id
        environment.updated_at = now
        environment.deleted_at = None

    await db.flush()
    return _environment_value(environment, repo)
