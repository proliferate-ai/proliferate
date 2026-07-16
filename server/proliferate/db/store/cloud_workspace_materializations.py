"""Persistence helpers for the durable cloud workspace materialization ledger.

Rows are soft-deleted via ``unlinked_at`` and never hard-deleted, so stale
reports and operation retries can be rejected by ``generation``. Intent reuse,
report, relink, and unlink all lock the workspace's active rows with
``.with_for_update()`` so concurrent operations converge deterministically.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workspace_materializations import (
    CloudWorkspaceMaterialization,
)
from proliferate.utils.time import utcnow

MaterializationTargetKind = Literal["managed_cloud", "local_desktop"]
MaterializationState = Literal[
    "pending",
    "hydrating",
    "hydrated",
    "missing",
    "inconsistent",
    "failed",
]


@dataclass(frozen=True)
class CloudWorkspaceMaterializationValue:
    id: UUID
    cloud_workspace_id: UUID
    target_kind: str
    cloud_sandbox_id: UUID | None
    desktop_install_id: str | None
    anyharness_workspace_id: str | None
    worktree_path: str | None
    state: str
    generation: int
    expected_head_sha: str | None
    observed_head_sha: str | None
    observed_branch: str | None
    failure_code: str | None
    failure_detail: str | None
    last_reported_at: datetime | None
    unlinked_at: datetime | None
    created_at: datetime
    updated_at: datetime


def cloud_workspace_materialization_value(
    row: CloudWorkspaceMaterialization,
) -> CloudWorkspaceMaterializationValue:
    return CloudWorkspaceMaterializationValue(
        id=row.id,
        cloud_workspace_id=row.cloud_workspace_id,
        target_kind=row.target_kind,
        cloud_sandbox_id=row.cloud_sandbox_id,
        desktop_install_id=row.desktop_install_id,
        anyharness_workspace_id=row.anyharness_workspace_id,
        worktree_path=row.worktree_path,
        state=row.state,
        generation=row.generation,
        expected_head_sha=row.expected_head_sha,
        observed_head_sha=row.observed_head_sha,
        observed_branch=row.observed_branch,
        failure_code=row.failure_code,
        failure_detail=row.failure_detail,
        last_reported_at=row.last_reported_at,
        unlinked_at=row.unlinked_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def list_active_materializations_for_workspace(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID,
) -> list[CloudWorkspaceMaterializationValue]:
    rows = (
        (
            await db.execute(
                select(CloudWorkspaceMaterialization)
                .where(
                    CloudWorkspaceMaterialization.cloud_workspace_id == cloud_workspace_id,
                    CloudWorkspaceMaterialization.unlinked_at.is_(None),
                )
                .order_by(CloudWorkspaceMaterialization.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return [cloud_workspace_materialization_value(row) for row in rows]


async def list_active_materializations_for_workspaces(
    db: AsyncSession,
    *,
    cloud_workspace_ids: list[UUID],
) -> dict[UUID, list[CloudWorkspaceMaterializationValue]]:
    """Batch loader for list endpoints; keyed by workspace id, active rows only."""
    result: dict[UUID, list[CloudWorkspaceMaterializationValue]] = {
        workspace_id: [] for workspace_id in cloud_workspace_ids
    }
    if not cloud_workspace_ids:
        return result
    rows = (
        (
            await db.execute(
                select(CloudWorkspaceMaterialization)
                .where(
                    CloudWorkspaceMaterialization.cloud_workspace_id.in_(cloud_workspace_ids),
                    CloudWorkspaceMaterialization.unlinked_at.is_(None),
                )
                .order_by(CloudWorkspaceMaterialization.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        result.setdefault(row.cloud_workspace_id, []).append(
            cloud_workspace_materialization_value(row)
        )
    return result


async def lock_active_materializations_for_workspace(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID,
) -> list[CloudWorkspaceMaterializationValue]:
    rows = (
        (
            await db.execute(
                select(CloudWorkspaceMaterialization)
                .where(
                    CloudWorkspaceMaterialization.cloud_workspace_id == cloud_workspace_id,
                    CloudWorkspaceMaterialization.unlinked_at.is_(None),
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    return [cloud_workspace_materialization_value(row) for row in rows]


async def load_materialization(
    db: AsyncSession,
    materialization_id: UUID,
    *,
    lock_row: bool = False,
) -> CloudWorkspaceMaterializationValue | None:
    stmt = select(CloudWorkspaceMaterialization).where(
        CloudWorkspaceMaterialization.id == materialization_id,
    )
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return cloud_workspace_materialization_value(row) if row is not None else None


async def get_active_managed_cloud_materialization(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID,
    lock_row: bool = False,
) -> CloudWorkspaceMaterializationValue | None:
    stmt = select(CloudWorkspaceMaterialization).where(
        CloudWorkspaceMaterialization.cloud_workspace_id == cloud_workspace_id,
        CloudWorkspaceMaterialization.target_kind == "managed_cloud",
        CloudWorkspaceMaterialization.unlinked_at.is_(None),
    )
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return cloud_workspace_materialization_value(row) if row is not None else None


async def get_active_local_materialization(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID,
    desktop_install_id: str,
    lock_row: bool = False,
) -> CloudWorkspaceMaterializationValue | None:
    stmt = select(CloudWorkspaceMaterialization).where(
        CloudWorkspaceMaterialization.cloud_workspace_id == cloud_workspace_id,
        CloudWorkspaceMaterialization.target_kind == "local_desktop",
        CloudWorkspaceMaterialization.desktop_install_id == desktop_install_id,
        CloudWorkspaceMaterialization.unlinked_at.is_(None),
    )
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return cloud_workspace_materialization_value(row) if row is not None else None


async def insert_managed_cloud_materialization(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID,
    cloud_sandbox_id: UUID | None,
    anyharness_workspace_id: str | None,
    state: MaterializationState,
    expected_head_sha: str | None = None,
    observed_head_sha: str | None = None,
    observed_branch: str | None = None,
) -> CloudWorkspaceMaterializationValue | None:
    """Insert one active managed-Cloud row; returns None on active-uniqueness race."""
    now = utcnow()
    row = CloudWorkspaceMaterialization(
        cloud_workspace_id=cloud_workspace_id,
        target_kind="managed_cloud",
        cloud_sandbox_id=cloud_sandbox_id,
        desktop_install_id=None,
        anyharness_workspace_id=anyharness_workspace_id,
        worktree_path=None,
        state=state,
        generation=1,
        expected_head_sha=expected_head_sha,
        observed_head_sha=observed_head_sha,
        observed_branch=observed_branch,
        last_reported_at=None,
        unlinked_at=None,
        created_at=now,
        updated_at=now,
    )
    try:
        async with db.begin_nested():
            db.add(row)
            await db.flush()
    except IntegrityError:
        return None
    return cloud_workspace_materialization_value(row)


async def create_local_desktop_intent(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID,
    desktop_install_id: str,
    expected_head_sha: str,
    observed_branch: str,
) -> CloudWorkspaceMaterializationValue | None:
    """Insert a fresh local-desktop intent row; returns None on active-uniqueness race."""
    now = utcnow()
    row = CloudWorkspaceMaterialization(
        cloud_workspace_id=cloud_workspace_id,
        target_kind="local_desktop",
        cloud_sandbox_id=None,
        desktop_install_id=desktop_install_id,
        anyharness_workspace_id=None,
        worktree_path=None,
        state="pending",
        generation=1,
        expected_head_sha=expected_head_sha,
        observed_head_sha=None,
        observed_branch=observed_branch,
        last_reported_at=None,
        unlinked_at=None,
        created_at=now,
        updated_at=now,
    )
    try:
        async with db.begin_nested():
            db.add(row)
            await db.flush()
    except IntegrityError:
        return None
    return cloud_workspace_materialization_value(row)


async def refresh_local_desktop_intent(
    db: AsyncSession,
    materialization_id: UUID,
    *,
    expected_head_sha: str,
    observed_branch: str,
) -> CloudWorkspaceMaterializationValue | None:
    """Re-arm an existing active local intent for reuse.

    Bumps generation and resets state to ``pending`` so a second intent for the
    same workspace/install converges onto the one active row rather than racing
    a duplicate. Locks the row first.
    """
    row = await db.get(CloudWorkspaceMaterialization, materialization_id)
    if row is None or row.unlinked_at is not None:
        return None
    now = utcnow()
    row.generation += 1
    row.state = "pending"
    row.expected_head_sha = expected_head_sha
    row.observed_head_sha = None
    row.observed_branch = observed_branch
    row.anyharness_workspace_id = None
    row.worktree_path = None
    row.failure_code = None
    row.failure_detail = None
    row.updated_at = now
    await db.flush()
    return cloud_workspace_materialization_value(row)


async def apply_report(
    db: AsyncSession,
    materialization_id: UUID,
    *,
    state: MaterializationState,
    anyharness_workspace_id: str | None,
    worktree_path: str | None,
    observed_branch: str | None,
    observed_head_sha: str | None,
    failure_code: str | None,
    failure_detail: str | None,
) -> CloudWorkspaceMaterializationValue | None:
    """Persist a report onto a locked row. Caller has already validated generation."""
    row = await db.get(CloudWorkspaceMaterialization, materialization_id)
    if row is None:
        return None
    now = utcnow()
    row.state = state
    row.anyharness_workspace_id = anyharness_workspace_id
    row.worktree_path = worktree_path
    row.observed_branch = observed_branch
    row.observed_head_sha = observed_head_sha
    row.failure_code = failure_code
    row.failure_detail = failure_detail
    row.last_reported_at = now
    row.updated_at = now
    await db.flush()
    return cloud_workspace_materialization_value(row)


async def unlink_materialization(
    db: AsyncSession,
    materialization_id: UUID,
) -> CloudWorkspaceMaterializationValue | None:
    """Soft-delete a locked local row, invalidating its generation.

    Bumps generation so a completion report racing the unlink loses via a stale
    generation check. Mutates nothing else.
    """
    row = await db.get(CloudWorkspaceMaterialization, materialization_id)
    if row is None:
        return None
    now = utcnow()
    row.unlinked_at = now
    row.generation += 1
    row.updated_at = now
    await db.flush()
    return cloud_workspace_materialization_value(row)


async def mark_managed_cloud_missing(
    db: AsyncSession,
    materialization_id: UUID,
) -> CloudWorkspaceMaterializationValue | None:
    """Explicitly transition a managed-Cloud row to ``missing`` (destroyed sandbox).

    Never deletes the row; the logical workspace and any local materializations
    survive a destroyed sandbox.
    """
    row = await db.get(CloudWorkspaceMaterialization, materialization_id)
    if row is None:
        return None
    now = utcnow()
    row.state = "missing"
    row.updated_at = now
    await db.flush()
    return cloud_workspace_materialization_value(row)
