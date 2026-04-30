"""Cloud workspace persistence helpers for claimed automation runs."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from proliferate.db import engine as db_engine
from proliferate.db.models.cloud import CloudWorkspace
from proliferate.db.store.automation_run_claims import load_claimed_run_for_update
from proliferate.db.store.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTOR_KIND_CLOUD,
    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
)
from proliferate.db.store.cloud_workspaces import create_cloud_workspace_record


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
    cloud_repo_limit: int | None = None,
) -> CloudWorkspace | None:
    async with db_engine.async_session_factory() as db:
        run = await load_claimed_run_for_update(
            db,
            run_id=run_id,
            claim_id=claim_id,
            now=now,
            allowed_statuses=frozenset({AUTOMATION_RUN_STATUS_CREATING_WORKSPACE}),
            execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
            executor_kind=AUTOMATION_EXECUTOR_KIND_CLOUD,
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
