from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.mobility import CloudWorkspaceMobility
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_mobility import (
    backfill_cloud_workspace_mobility_from_workspace,
    ensure_cloud_workspace_mobility,
)
from proliferate.db.store.cloud_workspaces import get_existing_cloud_workspace
from proliferate.server.cloud.mobility.domain.lifecycle import (
    OWNER_LOCAL,
    active_lifecycle_state,
    is_retryable_mobility_failure,
)


def _cloud_workspace(
    *,
    user_id,
    branch: str,
    display_name: str = "Gannet",
) -> CloudWorkspace:
    return CloudWorkspace(
        user_id=user_id,
        billing_subject_id=uuid4(),
        display_name=display_name,
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        git_branch=branch,
        status="ready",
        template_version="test",
    )


@pytest.mark.asyncio
async def test_ensure_clears_retryable_handoff_failure(
    db_session: AsyncSession,
) -> None:
    user_id = uuid4()
    previous_handoff_id = uuid4()
    record = CloudWorkspaceMobility(
        user_id=user_id,
        display_name="Gannet",
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        git_branch="gannet",
        owner="local",
        lifecycle_state="handoff_failed",
        status_detail="Sync a supported cloud credential before starting a cloud workspace.",
        last_error="Sync a supported cloud credential before starting a cloud workspace.",
        cloud_workspace_id=None,
        active_handoff_op_id=None,
        last_handoff_op_id=previous_handoff_id,
        cloud_lost_at=None,
        cloud_lost_reason=None,
    )
    db_session.add(record)
    await db_session.commit()

    value = await ensure_cloud_workspace_mobility(
        db_session,
        user_id=user_id,
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        git_branch="gannet",
        owner_hint="local",
        active_lifecycle_state=active_lifecycle_state(OWNER_LOCAL),
        is_retryable_failure=is_retryable_mobility_failure,
        display_name="Gannet",
        cloud_workspace_id=None,
    )

    assert value.owner == "local"
    assert value.lifecycle_state == "local_active"
    assert value.status_detail is None
    assert value.last_error is None
    assert value.active_handoff_op_id is None
    assert value.last_handoff_op_id == previous_handoff_id


@pytest.mark.asyncio
async def test_backfill_direct_target_workspace_uses_local_owner(
    db_session: AsyncSession,
) -> None:
    user_id = uuid4()
    workspace = _cloud_workspace(user_id=user_id, branch="arctic")
    db_session.add(workspace)
    await db_session.flush()

    value = await backfill_cloud_workspace_mobility_from_workspace(
        db_session,
        workspace=workspace,
        active_lifecycle_state="cloud_active",
        is_retryable_failure=is_retryable_mobility_failure,
    )

    assert value.owner == "local"
    assert value.lifecycle_state == "local_active"
    assert value.cloud_workspace_id == workspace.id


@pytest.mark.asyncio
async def test_backfill_direct_target_workspace_repairs_cloud_owned_projection(
    db_session: AsyncSession,
) -> None:
    user_id = uuid4()
    workspace = _cloud_workspace(user_id=user_id, branch="vale")
    db_session.add(workspace)
    await db_session.flush()
    db_session.add(
        CloudWorkspaceMobility(
            user_id=user_id,
            display_name="Vale",
            git_provider="github",
            git_owner="proliferate-ai",
            git_repo_name="proliferate",
            git_branch="vale",
            owner="personal_cloud",
            lifecycle_state="cloud_active",
            status_detail="Ready",
            last_error=None,
            cloud_workspace_id=workspace.id,
            active_handoff_op_id=None,
            last_handoff_op_id=None,
            cloud_lost_at=None,
            cloud_lost_reason=None,
        )
    )
    await db_session.commit()

    value = await backfill_cloud_workspace_mobility_from_workspace(
        db_session,
        workspace=workspace,
        active_lifecycle_state="cloud_active",
        is_retryable_failure=is_retryable_mobility_failure,
    )

    assert value.owner == "local"
    assert value.lifecycle_state == "local_active"
    assert value.status_detail is None
    assert value.cloud_workspace_id == workspace.id


@pytest.mark.asyncio
async def test_direct_target_backfill_does_not_steal_existing_workspace_pointer(
    db_session: AsyncSession,
) -> None:
    user_id = uuid4()
    existing_workspace = _cloud_workspace(user_id=user_id, branch="shoal")
    direct_projection = _cloud_workspace(user_id=user_id, branch="shoal")
    db_session.add_all([existing_workspace, direct_projection])
    await db_session.flush()
    db_session.add(
        CloudWorkspaceMobility(
            user_id=user_id,
            display_name="Shoal",
            git_provider="github",
            git_owner="proliferate-ai",
            git_repo_name="proliferate",
            git_branch="shoal",
            owner="personal_cloud",
            lifecycle_state="cloud_active",
            status_detail=None,
            last_error=None,
            cloud_workspace_id=existing_workspace.id,
            active_handoff_op_id=None,
            last_handoff_op_id=None,
            cloud_lost_at=None,
            cloud_lost_reason=None,
        )
    )
    await db_session.commit()

    value = await backfill_cloud_workspace_mobility_from_workspace(
        db_session,
        workspace=direct_projection,
        active_lifecycle_state="cloud_active",
        is_retryable_failure=is_retryable_mobility_failure,
    )

    assert value.owner == "personal_cloud"
    assert value.lifecycle_state == "cloud_active"
    assert value.cloud_workspace_id == existing_workspace.id


@pytest.mark.asyncio
async def test_existing_cloud_workspace_lookup_tolerates_duplicate_active_rows(
    db_session: AsyncSession,
) -> None:
    user_id = uuid4()
    older = _cloud_workspace(user_id=user_id, branch="tern", display_name="Older")
    newer = _cloud_workspace(user_id=user_id, branch="tern", display_name="Newer")
    older.updated_at = datetime(2026, 1, 1, tzinfo=UTC)
    newer.updated_at = datetime(2026, 1, 2, tzinfo=UTC)
    db_session.add_all([older, newer])
    await db_session.flush()

    value = await get_existing_cloud_workspace(
        db_session,
        user_id=user_id,
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        git_branch="tern",
    )

    assert value is not None
    assert value.id == newer.id
