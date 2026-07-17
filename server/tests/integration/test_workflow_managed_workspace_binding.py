"""Real-Postgres proof for exact managed Workflow workspace binding."""

from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from proliferate.db.models.cloud.workspace_materializations import (
    CloudWorkspaceMaterialization,
)
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import cloud_workspaces as workspace_store
from proliferate.db.store import repositories as repository_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces import workflow_binding
from tests.integration.cloud_api_helpers import register_and_login


@pytest.mark.asyncio
async def test_scratch_binding_converges_and_retains_exact_identity(
    client: AsyncClient,
    test_engine: AsyncEngine,
) -> None:
    owner = await register_and_login(client, "managed-binding@example.com")
    foreign = await register_and_login(client, "managed-binding-foreign@example.com")
    owner_id = UUID(owner["user_id"])
    invocation_id = uuid4()
    sandbox_id = uuid4()
    runtime_workspace_id = "workspace-managed-scratch"
    factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async with factory() as db, db.begin():
        db.add(
            CloudSandbox(
                id=sandbox_id,
                owner_user_id=owner_id,
                sandbox_type="e2b",
                status="ready",
            )
        )

    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(CloudWorkspace)) == 0

    async def bind_once():  # type: ignore[no-untyped-def]
        async with factory() as db, db.begin():
            return await workflow_binding.bind_managed_workflow_workspace(
                db,
                user_id=owner_id,
                invocation_id=invocation_id,
                placement_kind="scratch",
                repo_environment=None,
                base_ref=None,
                cloud_sandbox_id=sandbox_id,
                anyharness_workspace_id=runtime_workspace_id,
            )

    first, duplicate = await asyncio.gather(bind_once(), bind_once())
    assert first.id == duplicate.id
    assert first.workspace_kind == "scratch"
    assert first.repo_environment_id is None
    assert first.git_branch == "main"
    assert first.git_base_branch is None

    async with factory() as db:
        workspace_count = await db.scalar(
            select(func.count())
            .select_from(CloudWorkspace)
            .where(CloudWorkspace.owner_user_id == owner_id)
        )
        materializations = (
            (
                await db.execute(
                    select(CloudWorkspaceMaterialization).where(
                        CloudWorkspaceMaterialization.cloud_workspace_id == first.id,
                        CloudWorkspaceMaterialization.target_kind == "managed_cloud",
                        CloudWorkspaceMaterialization.unlinked_at.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        assert workspace_count == 1
        assert len(materializations) == 1
        assert materializations[0].cloud_sandbox_id == sandbox_id
        assert materializations[0].anyharness_workspace_id == runtime_workspace_id

    async with factory() as db:
        with pytest.raises(CloudApiError) as mismatch:
            async with db.begin():
                await workflow_binding.bind_managed_workflow_workspace(
                    db,
                    user_id=owner_id,
                    invocation_id=invocation_id,
                    placement_kind="scratch",
                    repo_environment=None,
                    base_ref=None,
                    cloud_sandbox_id=uuid4(),
                    anyharness_workspace_id=runtime_workspace_id,
                    expected_cloud_workspace_id=first.id,
                )
        assert mismatch.value.code == "workflow_workspace_materialization_mismatch"

    async with factory() as db:
        with pytest.raises(CloudApiError) as ownership:
            async with db.begin():
                await workflow_binding.bind_managed_workflow_workspace(
                    db,
                    user_id=UUID(foreign["user_id"]),
                    invocation_id=invocation_id,
                    placement_kind="scratch",
                    repo_environment=None,
                    base_ref=None,
                    cloud_sandbox_id=sandbox_id,
                    anyharness_workspace_id=runtime_workspace_id,
                    expected_cloud_workspace_id=first.id,
                )
        assert ownership.value.code == "workflow_workspace_binding_mismatch"

    async with factory() as db, db.begin():
        archived = await workspace_store.archive_cloud_workspace(db, first)
    assert archived.archived_at is not None
    async with factory() as db, db.begin():
        replay = await workflow_binding.bind_managed_workflow_workspace(
            db,
            user_id=owner_id,
            invocation_id=invocation_id,
            placement_kind="scratch",
            repo_environment=None,
            base_ref=None,
            cloud_sandbox_id=sandbox_id,
            anyharness_workspace_id=runtime_workspace_id,
        )
    assert replay.id == first.id
    assert replay.archived_at is not None

    async with factory() as db, db.begin():
        await workspace_store.delete_cloud_workspace(db, replay)
    async with factory() as db:
        with pytest.raises(CloudApiError) as deleted:
            async with db.begin():
                await workflow_binding.bind_managed_workflow_workspace(
                    db,
                    user_id=owner_id,
                    invocation_id=invocation_id,
                    placement_kind="scratch",
                    repo_environment=None,
                    base_ref=None,
                    cloud_sandbox_id=sandbox_id,
                    anyharness_workspace_id=runtime_workspace_id,
                    expected_cloud_workspace_id=first.id,
                )
        assert deleted.value.code == "workflow_workspace_binding_lost"
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(CloudWorkspace)) == 0


@pytest.mark.asyncio
async def test_repository_binding_pins_frozen_repo_and_base(
    client: AsyncClient,
    test_engine: AsyncEngine,
) -> None:
    owner = await register_and_login(client, "managed-binding-repo@example.com")
    owner_id = UUID(owner["user_id"])
    invocation_id = uuid4()
    sandbox_id = uuid4()
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as db, db.begin():
        db.add(
            CloudSandbox(
                id=sandbox_id,
                owner_user_id=owner_id,
                sandbox_type="e2b",
                status="ready",
            )
        )
        repo_environment = await repository_store.upsert_cloud_repo_environment(
            db,
            user_id=owner_id,
            git_provider="github",
            git_owner="proliferate-ai",
            git_repo_name="managed-binding",
            default_branch="main",
            setup_script="",
            run_command="",
        )
    async with factory() as db, db.begin():
        workspace = await workflow_binding.bind_managed_workflow_workspace(
            db,
            user_id=owner_id,
            invocation_id=invocation_id,
            placement_kind="repositoryWorktree",
            repo_environment=repo_environment,
            base_ref="release/frozen",
            cloud_sandbox_id=sandbox_id,
            anyharness_workspace_id="workspace-managed-repository",
        )
    assert workspace.workspace_kind == "repository_worktree"
    assert workspace.repo_environment_id == repo_environment.id
    assert workspace.git_branch == f"workflow/{invocation_id}"
    assert workspace.git_base_branch == "release/frozen"

    async with factory() as db:
        with pytest.raises(CloudApiError) as mismatch:
            async with db.begin():
                await workflow_binding.bind_managed_workflow_workspace(
                    db,
                    user_id=owner_id,
                    invocation_id=invocation_id,
                    placement_kind="repositoryWorktree",
                    repo_environment=repo_environment,
                    base_ref="main",
                    cloud_sandbox_id=sandbox_id,
                    anyharness_workspace_id="workspace-managed-repository",
                    expected_cloud_workspace_id=workspace.id,
                )
        assert mismatch.value.code == "workflow_workspace_binding_mismatch"
