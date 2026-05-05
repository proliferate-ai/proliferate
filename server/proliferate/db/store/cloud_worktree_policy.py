"""Persistence helpers for account-scoped cloud worktree cleanup policy."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.models.cloud import CloudWorktreeRetentionPolicy
from proliferate.utils.time import utcnow

DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO = 20
MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO = 10
MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO = 100


@dataclass(frozen=True)
class CloudWorktreePolicyValue:
    user_id: UUID
    max_materialized_worktrees_per_repo: int
    created_at: datetime
    updated_at: datetime


def _policy_value(record: CloudWorktreeRetentionPolicy) -> CloudWorktreePolicyValue:
    return CloudWorktreePolicyValue(
        user_id=record.user_id,
        max_materialized_worktrees_per_repo=record.max_materialized_worktrees_per_repo,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


async def get_cloud_worktree_policy(
    db: AsyncSession,
    user_id: UUID,
) -> CloudWorktreePolicyValue | None:
    record = (
        await db.execute(
            select(CloudWorktreeRetentionPolicy).where(
                CloudWorktreeRetentionPolicy.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    return None if record is None else _policy_value(record)


async def save_cloud_worktree_policy(
    db: AsyncSession,
    *,
    user_id: UUID,
    max_materialized_worktrees_per_repo: int,
) -> CloudWorktreePolicyValue:
    now = utcnow()
    await db.execute(
        pg_insert(CloudWorktreeRetentionPolicy)
        .values(
            user_id=user_id,
            max_materialized_worktrees_per_repo=max_materialized_worktrees_per_repo,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[CloudWorktreeRetentionPolicy.user_id],
            set_={
                "max_materialized_worktrees_per_repo": max_materialized_worktrees_per_repo,
                "updated_at": now,
            },
        )
    )
    await db.commit()
    value = await get_cloud_worktree_policy(db, user_id)
    if value is None:
        raise RuntimeError("Cloud worktree retention policy was not persisted.")
    return value


async def load_cloud_worktree_policy_for_user(
    user_id: UUID,
) -> CloudWorktreePolicyValue | None:
    async with db_engine.async_session_factory() as db:
        return await get_cloud_worktree_policy(db, user_id)


async def persist_cloud_worktree_policy_for_user(
    *,
    user_id: UUID,
    max_materialized_worktrees_per_repo: int,
) -> CloudWorktreePolicyValue:
    async with db_engine.async_session_factory() as db:
        return await save_cloud_worktree_policy(
            db,
            user_id=user_id,
            max_materialized_worktrees_per_repo=max_materialized_worktrees_per_repo,
        )
