from __future__ import annotations

import asyncio
import uuid
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.db import engine as engine_module
from proliferate.db.models.cloud import CloudSandbox, CloudWorkspace
from proliferate.db.store.billing import (
    count_active_cloud_repo_environments,
    ensure_personal_billing_subject,
)
from proliferate.db.store.cloud_workspaces import (
    CloudRepoLimitExceededError,
    create_cloud_workspace_for_user,
    delete_cloud_workspace_records,
)


def _patch_global_session_factory(
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )


async def _create_workspace(
    *,
    user_id: uuid.UUID,
    repo_name: str,
    branch_name: str = "main",
    cloud_repo_limit: int,
):
    return await create_cloud_workspace_for_user(
        user_id=user_id,
        display_name=f"acme/{repo_name}",
        git_provider="github",
        git_owner="acme",
        git_repo_name=repo_name,
        git_branch=branch_name,
        git_base_branch="main",
        origin_json=None,
        template_version="v1",
        cloud_repo_limit=cloud_repo_limit,
    )


@pytest.mark.asyncio
async def test_cloud_repo_limit_is_transactional_at_cap_boundary(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_global_session_factory(test_engine, monkeypatch)
    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    await db_session.commit()

    for index in range(3):
        await _create_workspace(
            user_id=user_id,
            repo_name=f"repo-{index}",
            cloud_repo_limit=4,
        )

    results = await asyncio.gather(
        _create_workspace(
            user_id=user_id,
            repo_name="repo-3",
            cloud_repo_limit=4,
        ),
        _create_workspace(
            user_id=user_id,
            repo_name="repo-4",
            cloud_repo_limit=4,
        ),
        return_exceptions=True,
    )

    successes = [result for result in results if not isinstance(result, Exception)]
    repo_limit_errors = [
        result for result in results if isinstance(result, CloudRepoLimitExceededError)
    ]
    assert len(successes) == 1
    assert len(repo_limit_errors) == 1
    assert repo_limit_errors[0].active_repo_count == 4
    assert repo_limit_errors[0].cloud_repo_limit == 4

    active_repo_count = await count_active_cloud_repo_environments(
        db_session,
        subject.id,
    )
    assert active_repo_count == 4


@pytest.mark.asyncio
async def test_existing_repo_branch_creation_is_allowed_at_repo_cap(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_global_session_factory(test_engine, monkeypatch)
    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    await db_session.commit()

    await _create_workspace(
        user_id=user_id,
        repo_name="rocket",
        branch_name="main",
        cloud_repo_limit=1,
    )

    workspace = await _create_workspace(
        user_id=user_id,
        repo_name="rocket",
        branch_name="feature",
        cloud_repo_limit=1,
    )

    assert workspace.git_branch == "feature"
    active_repo_count = await count_active_cloud_repo_environments(
        db_session,
        subject.id,
    )
    assert active_repo_count == 1


@pytest.mark.asyncio
async def test_archived_workspace_releases_cloud_repo_slot(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_global_session_factory(test_engine, monkeypatch)
    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    await db_session.commit()

    workspace_to_archive = await _create_workspace(
        user_id=user_id,
        repo_name="archived",
        cloud_repo_limit=1,
    )

    workspace_for_archive = await db_session.get(CloudWorkspace, workspace_to_archive.id)
    assert workspace_for_archive is not None
    await delete_cloud_workspace_records(db_session, workspace_for_archive)
    assert workspace_for_archive.archived_at is not None

    replacement = await _create_workspace(
        user_id=user_id,
        repo_name="replacement",
        cloud_repo_limit=1,
    )

    assert replacement.git_repo_name == "replacement"
    active_repo_count = await count_active_cloud_repo_environments(
        db_session,
        subject.id,
    )
    assert active_repo_count == 1


@pytest.mark.asyncio
async def test_legacy_null_runtime_workspace_consumes_cloud_repo_slot(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_global_session_factory(test_engine, monkeypatch)
    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    legacy_workspace = CloudWorkspace(
        user_id=user_id,
        billing_subject_id=subject.id,
        runtime_environment_id=None,
        display_name="acme/legacy",
        git_provider="github",
        git_owner="Acme",
        git_repo_name="Legacy",
        git_branch="main",
        git_base_branch="main",
        origin_json=None,
        status="ready",
        status_detail="Ready",
        template_version="v1",
        runtime_generation=1,
    )
    db_session.add(legacy_workspace)
    await db_session.flush()
    db_session.add(
        CloudSandbox(
            cloud_workspace_id=legacy_workspace.id,
            provider="e2b",
            external_sandbox_id="sandbox-legacy",
            status="paused",
            template_version="v1",
        )
    )
    await db_session.commit()

    assert await count_active_cloud_repo_environments(db_session, subject.id) == 1

    with pytest.raises(CloudRepoLimitExceededError):
        await _create_workspace(
            user_id=user_id,
            repo_name="replacement",
            cloud_repo_limit=1,
        )

    same_repo_workspace = await _create_workspace(
        user_id=user_id,
        repo_name="legacy",
        branch_name="feature",
        cloud_repo_limit=1,
    )
    assert same_repo_workspace.git_branch == "feature"
