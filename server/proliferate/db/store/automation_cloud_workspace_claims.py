"""Cloud workspace persistence helpers for claimed automation runs."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTOR_KIND_CLOUD,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.automation_run_claims import (
    ClaimActivePredicate,
    ClaimTransitionRule,
    load_claimed_run_for_update,
)
from proliferate.db.store.cloud_workspaces import (
    create_cloud_workspace_record,
    create_managed_cloud_workspace_for_profile,
)


async def create_cloud_workspace_for_claimed_run(
    *,
    run_id: UUID,
    claim_id: UUID,
    user_id: UUID,
    display_name: str | None,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    git_base_branch: str,
    origin_json: str | None,
    template_version: str,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
    cloud_repo_limit: int | None = None,
) -> CloudWorkspace | None:
    async with db_engine.async_session_factory() as db:
        run = await load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=transition.allowed_statuses,
            execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
            executor_kind=AUTOMATION_EXECUTOR_KIND_CLOUD,
            claim_is_active=claim_is_active,
            user_id=user_id,
        )
        if run is None:
            return None
        if run.cloud_workspace_id is not None:
            return None
        workspace = await create_cloud_workspace_record(
            db,
            user_id=user_id,
            display_name=display_name,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            git_branch=git_branch,
            git_base_branch=git_base_branch,
            origin_json=origin_json,
            template_version=template_version,
            cloud_repo_limit=cloud_repo_limit,
            commit=False,
        )
        run.cloud_workspace_id = workspace.id
        run.updated_at = now
        await db.commit()
        await db.refresh(workspace)
        return workspace


async def create_managed_cloud_workspace_for_claimed_run(
    *,
    run_id: UUID,
    claim_id: UUID,
    sandbox_profile_id: UUID,
    target_id: UUID,
    user_id: UUID,
    display_name: str | None,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    git_base_branch: str,
    worktree_path: str | None,
    origin_json: str | None,
    template_version: str,
    now: datetime,
    transition: ClaimTransitionRule,
    claim_is_active: ClaimActivePredicate,
) -> CloudWorkspace | None:
    async with db_engine.async_session_factory() as db:
        run = await load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=transition.allowed_statuses,
            execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
            executor_kind=AUTOMATION_EXECUTOR_KIND_CLOUD,
            claim_is_active=claim_is_active,
            user_id=user_id,
        )
        if run is None:
            return None
        if run.cloud_workspace_id is not None:
            return None
        workspace = await create_managed_cloud_workspace_for_profile(
            db,
            sandbox_profile_id=sandbox_profile_id,
            target_id=target_id,
            created_by_user_id=user_id,
            display_name=display_name,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            git_branch=git_branch,
            git_base_branch=git_base_branch,
            worktree_path=worktree_path,
            origin_json=origin_json,
            template_version=template_version,
        )
        run.cloud_workspace_id = workspace.id
        run.updated_at = now
        await db.commit()
        await db.refresh(workspace)
        return workspace
