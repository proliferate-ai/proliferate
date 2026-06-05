from __future__ import annotations

from typing import Protocol
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.mobility import CloudWorkspaceHandoffOp, CloudWorkspaceMobility
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_mobility.mappers import (
    _active_lifecycle_state_for_owner,
    _mobility_value,
    _normalize_owner,
)
from proliferate.db.store.cloud_mobility.records import CloudWorkspaceMobilityValue
from proliferate.utils.time import utcnow


class RetryableMobilityFailurePredicate(Protocol):
    def __call__(
        self,
        *,
        lifecycle_state: str,
        has_active_handoff: bool,
    ) -> bool: ...


_ACTIVE_LIFECYCLE_STATES = frozenset(
    {
        "local_active",
        "cloud_active",
        "shared_cloud_active",
        "ssh_active",
    }
)


def _owner_hint_for_backfilled_workspace(workspace: CloudWorkspace) -> str:
    # Rows without a sandbox profile or runtime environment are direct target
    # projections, such as desktop-dispatch worktrees. They should not make the
    # logical workspace look owned by a managed cloud sandbox.
    if workspace.sandbox_profile_id is None and workspace.runtime_environment_id is None:
        return "local"
    return "personal_cloud"


def _should_repair_active_backfill_owner(
    record: CloudWorkspaceMobility,
    *,
    owner_hint: str,
    active_lifecycle_state: str,
    cloud_workspace_id: UUID | None,
) -> bool:
    if record.active_handoff_op_id is not None:
        return False
    if record.lifecycle_state not in _ACTIVE_LIFECYCLE_STATES:
        return False
    if cloud_workspace_id is not None and record.cloud_workspace_id not in {
        None,
        cloud_workspace_id,
    }:
        return False
    return (
        _normalize_owner(record.owner) != _normalize_owner(owner_hint)
        or record.lifecycle_state != active_lifecycle_state
    )


def _clear_retryable_handoff_failure(
    record: CloudWorkspaceMobility,
    *,
    owner_hint: str,
    active_lifecycle_state: str,
    is_retryable_failure: RetryableMobilityFailurePredicate,
) -> bool:
    if not is_retryable_failure(
        lifecycle_state=record.lifecycle_state,
        has_active_handoff=record.active_handoff_op_id is not None,
    ):
        return False

    record.owner = _normalize_owner(owner_hint)
    record.lifecycle_state = active_lifecycle_state
    record.status_detail = None
    record.last_error = None
    return True


async def _get_handoff_op_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    handoff_op_id: UUID,
) -> CloudWorkspaceHandoffOp | None:
    return (
        await db.execute(
            select(CloudWorkspaceHandoffOp).where(
                CloudWorkspaceHandoffOp.id == handoff_op_id,
                CloudWorkspaceHandoffOp.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def get_cloud_workspace_mobility(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
) -> CloudWorkspaceMobility | None:
    return (
        await db.execute(
            select(CloudWorkspaceMobility).where(
                CloudWorkspaceMobility.id == mobility_workspace_id,
                CloudWorkspaceMobility.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def get_cloud_workspace_mobility_for_update(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
) -> CloudWorkspaceMobility | None:
    return (
        await db.execute(
            select(CloudWorkspaceMobility)
            .where(
                CloudWorkspaceMobility.id == mobility_workspace_id,
                CloudWorkspaceMobility.user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()


async def get_cloud_workspace_mobility_by_identity(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
) -> CloudWorkspaceMobility | None:
    return (
        await db.execute(
            select(CloudWorkspaceMobility).where(
                CloudWorkspaceMobility.user_id == user_id,
                CloudWorkspaceMobility.git_provider == git_provider,
                CloudWorkspaceMobility.git_owner == git_owner,
                CloudWorkspaceMobility.git_repo_name == git_repo_name,
                CloudWorkspaceMobility.git_branch == git_branch,
            )
        )
    ).scalar_one_or_none()


async def list_cloud_workspace_mobility(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[CloudWorkspaceMobility]:
    return list(
        (
            await db.execute(
                select(CloudWorkspaceMobility)
                .where(CloudWorkspaceMobility.user_id == user_id)
                .order_by(CloudWorkspaceMobility.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )


async def load_cloud_workspace_mobility_value(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
) -> CloudWorkspaceMobilityValue | None:
    record = await get_cloud_workspace_mobility(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    if record is None:
        return None
    active_handoff = None
    if record.active_handoff_op_id is not None:
        active_handoff = await _get_handoff_op_for_user(
            db,
            user_id=user_id,
            handoff_op_id=record.active_handoff_op_id,
        )
    return _mobility_value(record, active_handoff=active_handoff)


async def ensure_cloud_workspace_mobility(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    owner_hint: str,
    active_lifecycle_state: str,
    is_retryable_failure: RetryableMobilityFailurePredicate,
    display_name: str | None,
    cloud_workspace_id: UUID | None,
    repair_active_owner: bool = False,
) -> CloudWorkspaceMobilityValue:
    record = await get_cloud_workspace_mobility_by_identity(
        db,
        user_id=user_id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=git_branch,
    )
    now = utcnow()
    if record is None:
        record = CloudWorkspaceMobility(
            user_id=user_id,
            display_name=display_name,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            git_branch=git_branch,
            owner=_normalize_owner(owner_hint),
            lifecycle_state=active_lifecycle_state,
            status_detail=None,
            last_error=None,
            cloud_workspace_id=cloud_workspace_id,
            active_handoff_op_id=None,
            last_handoff_op_id=None,
            cloud_lost_at=None,
            cloud_lost_reason=None,
            created_at=now,
            updated_at=now,
        )
        db.add(record)
        await db.flush()
        await db.refresh(record)
        return _mobility_value(record)

    changed = _clear_retryable_handoff_failure(
        record,
        owner_hint=owner_hint,
        active_lifecycle_state=active_lifecycle_state,
        is_retryable_failure=is_retryable_failure,
    )
    if repair_active_owner and _should_repair_active_backfill_owner(
        record,
        owner_hint=owner_hint,
        active_lifecycle_state=active_lifecycle_state,
        cloud_workspace_id=cloud_workspace_id,
    ):
        record.owner = _normalize_owner(owner_hint)
        record.lifecycle_state = active_lifecycle_state
        record.status_detail = None
        record.last_error = None
        changed = True
    if display_name is not None and display_name != record.display_name:
        record.display_name = display_name
        changed = True
    should_update_cloud_workspace_id = (
        cloud_workspace_id is not None and record.cloud_workspace_id != cloud_workspace_id
    )
    if (
        should_update_cloud_workspace_id
        and repair_active_owner
        and _normalize_owner(owner_hint) == "local"
        and record.cloud_workspace_id is not None
    ):
        should_update_cloud_workspace_id = False
    if should_update_cloud_workspace_id:
        record.cloud_workspace_id = cloud_workspace_id
        changed = True
    if changed:
        record.updated_at = now
        await db.flush()
        await db.refresh(record)

    active_handoff = None
    if record.active_handoff_op_id is not None:
        active_handoff = await _get_handoff_op_for_user(
            db,
            user_id=user_id,
            handoff_op_id=record.active_handoff_op_id,
        )
    return _mobility_value(record, active_handoff=active_handoff)


async def backfill_cloud_workspace_mobility_from_workspace(
    db: AsyncSession,
    *,
    workspace: CloudWorkspace,
    active_lifecycle_state: str,
    is_retryable_failure: RetryableMobilityFailurePredicate,
) -> CloudWorkspaceMobilityValue:
    owner_hint = _owner_hint_for_backfilled_workspace(workspace)
    return await ensure_cloud_workspace_mobility(
        db,
        user_id=workspace.user_id,
        git_provider=workspace.git_provider,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
        git_branch=workspace.git_branch,
        owner_hint=owner_hint,
        active_lifecycle_state=(
            active_lifecycle_state
            if _normalize_owner(owner_hint) == "personal_cloud"
            else _active_lifecycle_state_for_owner(owner_hint)
        ),
        is_retryable_failure=is_retryable_failure,
        display_name=workspace.display_name,
        cloud_workspace_id=workspace.id,
        repair_active_owner=_normalize_owner(owner_hint) == "local",
    )


async def list_cloud_workspace_mobility_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[CloudWorkspaceMobilityValue]:
    records = await list_cloud_workspace_mobility(db, user_id=user_id)
    values: list[CloudWorkspaceMobilityValue] = []
    for record in records:
        active_handoff = None
        if record.active_handoff_op_id is not None:
            active_handoff = await _get_handoff_op_for_user(
                db,
                user_id=user_id,
                handoff_op_id=record.active_handoff_op_id,
            )
        values.append(_mobility_value(record, active_handoff=active_handoff))
    return values


async def load_cloud_workspace_mobility_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
) -> CloudWorkspaceMobilityValue | None:
    return await load_cloud_workspace_mobility_value(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )


async def ensure_cloud_workspace_mobility_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    owner_hint: str,
    active_lifecycle_state: str,
    is_retryable_failure: RetryableMobilityFailurePredicate,
    display_name: str | None,
    cloud_workspace_id: UUID | None,
) -> CloudWorkspaceMobilityValue:
    return await ensure_cloud_workspace_mobility(
        db,
        user_id=user_id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=git_branch,
        owner_hint=owner_hint,
        active_lifecycle_state=active_lifecycle_state,
        is_retryable_failure=is_retryable_failure,
        display_name=display_name,
        cloud_workspace_id=cloud_workspace_id,
    )


async def backfill_cloud_workspace_mobility_for_workspace(
    db: AsyncSession,
    *,
    workspace: CloudWorkspace,
    active_lifecycle_state: str,
    is_retryable_failure: RetryableMobilityFailurePredicate,
) -> CloudWorkspaceMobilityValue:
    return await backfill_cloud_workspace_mobility_from_workspace(
        db,
        workspace=workspace,
        active_lifecycle_state=active_lifecycle_state,
        is_retryable_failure=is_retryable_failure,
    )
