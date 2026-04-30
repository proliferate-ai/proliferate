from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud import CloudWorkspaceMobility
from proliferate.db.store.cloud_mobility import ensure_cloud_workspace_mobility


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
        display_name="Gannet",
        cloud_workspace_id=None,
    )

    assert value.owner == "local"
    assert value.lifecycle_state == "local_active"
    assert value.status_detail is None
    assert value.last_error is None
    assert value.active_handoff_op_id is None
    assert value.last_handoff_op_id == previous_handoff_id
