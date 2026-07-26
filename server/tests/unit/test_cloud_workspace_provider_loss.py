from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import (
    CLOUD_WORKSPACE_SCRATCH,
    CloudWorkspace,
)
from proliferate.db.models.cloud.workspace_materializations import (
    CloudWorkspaceMaterialization,
)
from proliferate.db.store import cloud_workspaces as workspace_store
from proliferate.db.store.cloud_sandboxes import cloud_sandbox_value


def _user() -> User:
    return User(
        email=f"workspace-loss-{uuid4().hex}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_verified=True,
    )


def _scratch_workspace(
    *,
    owner_user_id: UUID,
    anyharness_workspace_id: str | None,
    archived_at: datetime | None = None,
    lost_at: datetime | None = None,
) -> CloudWorkspace:
    return CloudWorkspace(
        owner_user_id=owner_user_id,
        workspace_kind=CLOUD_WORKSPACE_SCRATCH,
        repo_environment_id=None,
        display_name=f"Workspace {uuid4().hex[:8]}",
        git_branch="main",
        git_base_branch=None,
        anyharness_workspace_id=anyharness_workspace_id,
        archived_at=archived_at,
        lost_at=lost_at,
    )


@pytest.mark.asyncio
async def test_mark_cloud_workspaces_lost_for_sandbox_updates_only_active_bound_rows(
    db_session: AsyncSession,
) -> None:
    owner = _user()
    other_owner = _user()
    db_session.add_all([owner, other_owner])
    await db_session.flush()

    provider_loss_at = datetime.now(UTC)
    sandbox = CloudSandbox(
        owner_user_id=owner.id,
        sandbox_type="e2b",
        provider_sandbox_id="provider-lost",
        status="destroyed",
        destroyed_at=provider_loss_at,
    )
    replacement_sandbox = CloudSandbox(
        owner_user_id=owner.id,
        sandbox_type="e2b",
        provider_sandbox_id="provider-replacement",
        status="ready",
    )
    already_lost_at = datetime(2026, 7, 1, tzinfo=UTC)
    active_bound = _scratch_workspace(
        owner_user_id=owner.id,
        anyharness_workspace_id="runtime-active",
    )
    active_unbound = _scratch_workspace(
        owner_user_id=owner.id,
        anyharness_workspace_id=None,
    )
    legacy_bound = _scratch_workspace(
        owner_user_id=owner.id,
        anyharness_workspace_id="runtime-legacy",
    )
    archived_bound = _scratch_workspace(
        owner_user_id=owner.id,
        anyharness_workspace_id="runtime-archived",
        archived_at=datetime.now(UTC),
    )
    other_owner_bound = _scratch_workspace(
        owner_user_id=other_owner.id,
        anyharness_workspace_id="runtime-other-owner",
    )
    replacement_bound = _scratch_workspace(
        owner_user_id=owner.id,
        anyharness_workspace_id="runtime-replacement",
    )
    already_lost = _scratch_workspace(
        owner_user_id=owner.id,
        anyharness_workspace_id="runtime-already-lost",
        lost_at=already_lost_at,
    )
    db_session.add_all(
        [
            sandbox,
            replacement_sandbox,
            active_bound,
            active_unbound,
            legacy_bound,
            archived_bound,
            other_owner_bound,
            replacement_bound,
            already_lost,
        ]
    )
    await db_session.flush()
    db_session.add_all(
        [
            CloudWorkspaceMaterialization(
                cloud_workspace_id=active_bound.id,
                target_kind="managed_cloud",
                cloud_sandbox_id=sandbox.id,
                anyharness_workspace_id=active_bound.anyharness_workspace_id,
                state="hydrated",
            ),
            CloudWorkspaceMaterialization(
                cloud_workspace_id=replacement_bound.id,
                target_kind="managed_cloud",
                cloud_sandbox_id=replacement_sandbox.id,
                anyharness_workspace_id=replacement_bound.anyharness_workspace_id,
                state="hydrated",
            ),
        ]
    )
    await db_session.flush()

    updated_count = await workspace_store.mark_cloud_workspaces_lost_for_sandbox(
        db_session,
        cloud_sandbox_value(sandbox),
    )
    await db_session.flush()
    for workspace in (
        active_bound,
        active_unbound,
        legacy_bound,
        archived_bound,
        other_owner_bound,
        replacement_bound,
        already_lost,
    ):
        await db_session.refresh(workspace)

    assert updated_count == 2
    assert active_bound.lost_at is not None
    assert active_unbound.lost_at is None
    assert legacy_bound.lost_at is not None
    assert archived_bound.lost_at is None
    assert other_owner_bound.lost_at is None
    assert replacement_bound.lost_at is None
    assert already_lost.lost_at == already_lost_at
