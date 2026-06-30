"""Persistence helpers for logical repositories and repo environments."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import GitProvider, RepoEnvironmentKind
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class RepoEnvironmentValue:
    id: UUID
    repo_config_id: UUID
    user_id: UUID
    git_provider: str
    git_owner: str
    git_repo_name: str
    environment_kind: str
    desktop_install_id: str | None
    local_path: str | None
    default_branch: str | None
    setup_script: str
    run_command: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class RepoConfigValue:
    id: UUID
    user_id: UUID
    git_provider: str
    git_owner: str
    git_repo_name: str
    created_at: datetime
    updated_at: datetime
    environments: tuple[RepoEnvironmentValue, ...]


def _enum_value(value: object) -> str:
    raw = getattr(value, "value", value)
    return str(raw)


def _environment_value(row: RepoEnvironment, repo: RepoConfig) -> RepoEnvironmentValue:
    return RepoEnvironmentValue(
        id=row.id,
        repo_config_id=row.repo_config_id,
        user_id=repo.user_id,
        git_provider=_enum_value(repo.git_provider),
        git_owner=repo.git_owner,
        git_repo_name=repo.git_repo_name,
        environment_kind=_enum_value(row.environment_kind),
        desktop_install_id=row.desktop_install_id,
        local_path=row.local_path,
        default_branch=row.default_branch,
        setup_script=row.setup_script,
        run_command=row.run_command,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _ensure_repo_config(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
) -> RepoConfig:
    row = (
        await db.execute(
            select(RepoConfig).where(
                RepoConfig.user_id == user_id,
                RepoConfig.git_provider == git_provider,
                RepoConfig.git_owner == git_owner,
                RepoConfig.git_repo_name == git_repo_name,
                RepoConfig.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        return row

    now = utcnow()
    row = RepoConfig(
        user_id=user_id,
        git_provider=GitProvider(git_provider),
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return row


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
        user_id=row.user_id,
        git_provider=_enum_value(row.git_provider),
        git_owner=row.git_owner,
        git_repo_name=row.git_repo_name,
        created_at=row.created_at,
        updated_at=row.updated_at,
        environments=tuple(_environment_value(item, row) for item in environments),
    )


async def get_repo_config_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
) -> RepoConfigValue | None:
    row = (
        await db.execute(
            select(RepoConfig).where(
                RepoConfig.user_id == user_id,
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
                RepoConfig.user_id == user_id,
                RepoConfig.git_provider == GitProvider.github,
                RepoConfig.git_owner == git_owner,
                RepoConfig.git_repo_name == git_repo_name,
                RepoConfig.deleted_at.is_(None),
                RepoEnvironment.environment_kind == RepoEnvironmentKind.cloud,
                RepoEnvironment.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    if row is None:
        return None
    environment, repo = row
    return _environment_value(environment, repo)


async def get_repo_environment_by_id(
    db: AsyncSession,
    repo_environment_id: UUID,
) -> RepoEnvironmentValue | None:
    row = (
        await db.execute(
            select(RepoEnvironment, RepoConfig)
            .join(RepoConfig, RepoEnvironment.repo_config_id == RepoConfig.id)
            .where(
                RepoEnvironment.id == repo_environment_id,
                RepoEnvironment.deleted_at.is_(None),
                RepoConfig.deleted_at.is_(None),
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
                RepoConfig.user_id == user_id,
                RepoConfig.deleted_at.is_(None),
                RepoEnvironment.environment_kind == RepoEnvironmentKind.cloud,
                RepoEnvironment.deleted_at.is_(None),
            )
            .order_by(RepoConfig.git_owner.asc(), RepoConfig.git_repo_name.asc())
        )
    ).all()
    return tuple(_environment_value(environment, repo) for environment, repo in rows)


async def list_cloud_repo_environments_for_git_owner(
    db: AsyncSession,
    *,
    git_owner: str,
) -> tuple[RepoEnvironmentValue, ...]:
    rows = (
        await db.execute(
            select(RepoEnvironment, RepoConfig)
            .join(RepoConfig, RepoEnvironment.repo_config_id == RepoConfig.id)
            .where(
                RepoConfig.git_provider == GitProvider.github,
                RepoConfig.git_owner == git_owner,
                RepoConfig.deleted_at.is_(None),
                RepoEnvironment.environment_kind == RepoEnvironmentKind.cloud,
                RepoEnvironment.deleted_at.is_(None),
            )
            .order_by(RepoConfig.user_id.asc(), RepoConfig.git_repo_name.asc())
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


async def _upsert_environment(
    db: AsyncSession,
    *,
    repo: RepoConfig,
    environment_kind: RepoEnvironmentKind,
    desktop_install_id: str | None,
    local_path: str | None,
    default_branch: str | None,
    setup_script: str,
    run_command: str,
) -> RepoEnvironment:
    predicates = [
        RepoEnvironment.repo_config_id == repo.id,
        RepoEnvironment.environment_kind == environment_kind,
        RepoEnvironment.deleted_at.is_(None),
    ]
    if environment_kind == RepoEnvironmentKind.local:
        predicates.extend(
            [
                RepoEnvironment.desktop_install_id == desktop_install_id,
                RepoEnvironment.local_path == local_path,
            ]
        )
    row = (await db.execute(select(RepoEnvironment).where(*predicates))).scalar_one_or_none()
    now = utcnow()
    normalized_default_branch = (
        default_branch.strip() if default_branch and default_branch.strip() else None
    )
    if row is None:
        row = RepoEnvironment(
            repo_config_id=repo.id,
            environment_kind=environment_kind,
            desktop_install_id=desktop_install_id,
            local_path=local_path,
            default_branch=normalized_default_branch,
            setup_script=setup_script,
            run_command=run_command,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.desktop_install_id = desktop_install_id
        row.local_path = local_path
        row.default_branch = normalized_default_branch
        row.setup_script = setup_script
        row.run_command = run_command
        row.updated_at = now
    repo.updated_at = now
    await db.flush()
    return row


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
    repo = await _ensure_repo_config(
        db,
        user_id=user_id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    environment = await _upsert_environment(
        db,
        repo=repo,
        environment_kind=RepoEnvironmentKind.local,
        desktop_install_id=desktop_install_id,
        local_path=local_path,
        default_branch=default_branch,
        setup_script=setup_script,
        run_command=run_command,
    )
    return _environment_value(environment, repo)


async def upsert_cloud_repo_environment(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    default_branch: str | None,
    setup_script: str,
    run_command: str,
) -> RepoEnvironmentValue:
    repo = await _ensure_repo_config(
        db,
        user_id=user_id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    environment = await _upsert_environment(
        db,
        repo=repo,
        environment_kind=RepoEnvironmentKind.cloud,
        desktop_install_id=None,
        local_path=None,
        default_branch=default_branch,
        setup_script=setup_script,
        run_command=run_command,
    )
    return _environment_value(environment, repo)
