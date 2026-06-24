from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.db.store.cloud_repo_config import (
    CloudRepoFileInput,
    save_cloud_repo_config,
)
from proliferate.db.store.managed_sandbox_repo_materializations import (
    begin_repo_materialization,
    list_materializations_for_sandbox,
    load_repo_materialization,
    mark_repo_materialization_disabled,
    mark_repo_materialization_error,
    mark_repo_materialization_ready,
)
from proliferate.db.store.managed_sandboxes import (
    ensure_personal_managed_sandbox,
    load_personal_managed_sandbox,
    mark_managed_sandbox_destroyed,
    mark_managed_sandbox_health,
    mark_managed_sandbox_ready,
    update_managed_sandbox_status,
)


async def _create_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"managed-sandbox-{uuid.uuid4().hex}@proliferate.dev",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


@pytest.mark.asyncio
async def test_personal_managed_sandbox_lifecycle(db_session: AsyncSession) -> None:
    user = await _create_user(db_session)
    billing_subject = await ensure_personal_billing_subject(db_session, user.id)

    first = await ensure_personal_managed_sandbox(
        db_session,
        user_id=user.id,
        created_by_user_id=user.id,
        billing_subject_id=billing_subject.id,
        e2b_template_ref="tpl_v1",
    )
    second = await ensure_personal_managed_sandbox(
        db_session,
        user_id=user.id,
        created_by_user_id=user.id,
        billing_subject_id=billing_subject.id,
        e2b_template_ref="tpl_v2",
    )

    assert second.id == first.id
    assert second.status == "creating"
    assert second.e2b_template_ref == "tpl_v1"

    starting = await update_managed_sandbox_status(
        db_session,
        first.id,
        status="starting",
        last_error=None,
    )
    assert starting is not None
    assert starting.status == "starting"

    ready = await mark_managed_sandbox_ready(
        db_session,
        first.id,
        e2b_sandbox_id="e2b-sbx-1",
        e2b_template_ref="tpl_v1",
        anyharness_base_url="https://3000-e2b-sbx-1.e2b.dev",
        anyharness_bearer_token_ciphertext="token:v1",
        anyharness_data_key_ciphertext="data-key:v1",
    )
    assert ready is not None
    assert ready.status == "ready"
    assert ready.runtime_generation == 1
    assert ready.ready_at is not None
    assert ready.last_health_at is not None

    same_runtime = await mark_managed_sandbox_ready(
        db_session,
        first.id,
        e2b_sandbox_id="e2b-sbx-1",
        e2b_template_ref="tpl_v1",
        anyharness_base_url="https://3000-e2b-sbx-1.e2b.dev",
        anyharness_bearer_token_ciphertext="token:v1",
        anyharness_data_key_ciphertext="data-key:v1",
    )
    assert same_runtime is not None
    assert same_runtime.runtime_generation == 1

    next_runtime = await mark_managed_sandbox_ready(
        db_session,
        first.id,
        e2b_sandbox_id="e2b-sbx-2",
        e2b_template_ref="tpl_v1",
        anyharness_base_url="https://3000-e2b-sbx-2.e2b.dev",
        anyharness_bearer_token_ciphertext="token:v2",
        anyharness_data_key_ciphertext="data-key:v2",
    )
    assert next_runtime is not None
    assert next_runtime.runtime_generation == 2

    healthy = await mark_managed_sandbox_health(db_session, first.id)
    assert healthy is not None
    assert healthy.last_health_at is not None

    destroyed = await mark_managed_sandbox_destroyed(
        db_session,
        first.id,
        last_error="user requested destroy",
    )
    assert destroyed is not None
    assert destroyed.status == "destroyed"
    assert destroyed.destroyed_at is not None
    assert destroyed.last_error == "user requested destroy"
    assert await load_personal_managed_sandbox(db_session, user.id) is None

    replacement = await ensure_personal_managed_sandbox(
        db_session,
        user_id=user.id,
        created_by_user_id=user.id,
        billing_subject_id=billing_subject.id,
        e2b_template_ref="tpl_v3",
    )
    assert replacement.id != first.id
    assert replacement.status == "creating"
    assert replacement.e2b_template_ref == "tpl_v3"


@pytest.mark.asyncio
async def test_repo_materialization_tracks_generation_and_versions(
    db_session: AsyncSession,
) -> None:
    user = await _create_user(db_session)
    billing_subject = await ensure_personal_billing_subject(db_session, user.id)
    sandbox = await ensure_personal_managed_sandbox(
        db_session,
        user_id=user.id,
        created_by_user_id=user.id,
        billing_subject_id=billing_subject.id,
        e2b_template_ref="tpl_v1",
    )
    repo_config = await save_cloud_repo_config(
        db_session,
        user_id=user.id,
        git_owner="acme",
        git_repo_name="rocket",
        configured=True,
        cloud_repo_limit=10,
        default_branch="main",
        env_vars={"NODE_ENV": "test"},
        setup_script="pnpm install",
        run_command="pnpm dev",
        files=[
            CloudRepoFileInput(relative_path=".env.example", content="NODE_ENV=test\n"),
            CloudRepoFileInput(relative_path="README.md", content="# Rocket\n"),
        ],
    )

    running = await begin_repo_materialization(
        db_session,
        managed_sandbox_id=sandbox.id,
        cloud_repo_config_id=repo_config.id,
        sandbox_generation=1,
        repo_path="/home/user/workspace/repos/acme/rocket",
    )
    assert running.status == "running"
    assert running.last_attempted_at is not None
    assert running.applied_files_version == 0

    ready = await mark_repo_materialization_ready(
        db_session,
        running.id,
        anyharness_repo_root_id="repo-root-1",
        anyharness_workspace_id="workspace-1",
        applied_files_version=repo_config.files_version,
        applied_setup_script_version=repo_config.setup_script_version,
        applied_env_vars_version=repo_config.env_vars_version,
    )
    assert ready is not None
    assert ready.status == "ready"
    assert ready.materialized_at is not None
    assert ready.applied_files_version == repo_config.files_version
    assert ready.applied_setup_script_version == repo_config.setup_script_version
    assert ready.applied_env_vars_version == repo_config.env_vars_version

    loaded = await load_repo_materialization(
        db_session,
        managed_sandbox_id=sandbox.id,
        cloud_repo_config_id=repo_config.id,
    )
    assert loaded is not None
    assert loaded.id == running.id
    materializations = await list_materializations_for_sandbox(
        db_session,
        managed_sandbox_id=sandbox.id,
    )
    assert len(materializations) == 1

    rerun_same_generation = await begin_repo_materialization(
        db_session,
        managed_sandbox_id=sandbox.id,
        cloud_repo_config_id=repo_config.id,
        sandbox_generation=1,
        repo_path="/home/user/workspace/repos/acme/rocket",
    )
    assert rerun_same_generation.id == running.id
    assert rerun_same_generation.anyharness_repo_root_id == "repo-root-1"
    assert rerun_same_generation.anyharness_workspace_id == "workspace-1"

    rerun_next_generation = await begin_repo_materialization(
        db_session,
        managed_sandbox_id=sandbox.id,
        cloud_repo_config_id=repo_config.id,
        sandbox_generation=2,
        repo_path="/home/user/workspace/repos/acme/rocket",
    )
    assert rerun_next_generation.id == running.id
    assert rerun_next_generation.status == "running"
    assert rerun_next_generation.sandbox_generation == 2
    assert rerun_next_generation.anyharness_repo_root_id is None
    assert rerun_next_generation.anyharness_workspace_id is None
    assert rerun_next_generation.materialized_at is None
    assert rerun_next_generation.applied_files_version == 0

    failed = await mark_repo_materialization_error(
        db_session,
        running.id,
        last_error="clone failed",
    )
    assert failed is not None
    assert failed.status == "error"
    assert failed.last_error == "clone failed"

    disabled = await mark_repo_materialization_disabled(
        db_session,
        managed_sandbox_id=sandbox.id,
        cloud_repo_config_id=repo_config.id,
    )
    assert disabled is not None
    assert disabled.status == "disabled"
