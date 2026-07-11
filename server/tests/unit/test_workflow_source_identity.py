"""Source snapshot boundaries and exact selected-ref freezing."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

import pytest
from sqlalchemy import delete, inspect, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.constants.workflows import (
    WORKFLOW_TRIGGER_KIND_POLL,
    WORKFLOW_TRIGGER_KIND_SCHEDULE,
)
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.github_app import GitHubAppInstallation
from proliferate.db.models.cloud.workflows import Workflow, WorkflowRun, WorkflowVersion
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import github_app as github_app_store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.integrations.github import (
    GitHubAppInstallationInfo,
    GitHubAppRepositoryCoverage,
    GitHubAppUserAuthorization,
    GitHubBranchNotFound,
)
from proliferate.integrations import sentry as sentry_integration
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import compiler, source_resolution
from proliferate.utils.time import utcnow
from tests.unit.test_workflow_delivery import (
    _make_ready_cloud_workspace,
    _make_user,
    _make_workflow,
)

pytestmark = pytest.mark.asyncio


@dataclass(frozen=True)
class _AuthorityIds:
    authorization_id: UUID
    installation_id: UUID
    github_installation_id: str


async def _seed_source_authority(db: AsyncSession, user: User) -> _AuthorityIds:
    authorization = await github_app_store.upsert_github_app_authorization(
        db,
        user_id=user.id,
        authorization=GitHubAppUserAuthorization(
            access_token="cached-source-token",
            refresh_token=None,
            expires_at=utcnow() + timedelta(hours=2),
            refresh_token_expires_at=None,
            github_user_id="source-user",
            github_login="source-user",
            permissions={},
        ),
    )
    github_installation_id = f"source-{user.id}"
    installation = await github_app_store.upsert_github_app_installation(
        db,
        installation=GitHubAppInstallationInfo(
            github_installation_id=github_installation_id,
            account_login="acme",
            account_type="Organization",
            repository_selection="selected",
            permissions={"contents": "read"},
            suspended_at=None,
        ),
    )
    await github_app_store.upsert_installation_repo_cache(
        db,
        installation_id=installation.id,
        owner="acme",
        name="widgets",
        coverage=GitHubAppRepositoryCoverage(
            covered=True,
            repository_id="repo-1",
            private=True,
            default_branch="main",
        ),
    )
    return _AuthorityIds(
        authorization_id=authorization.id,
        installation_id=installation.id,
        github_installation_id=github_installation_id,
    )


def _patch_source(
    monkeypatch: pytest.MonkeyPatch,
    resolver: Callable[..., object],
) -> None:
    monkeypatch.setattr(source_resolution, "get_github_branch_head", resolver)


async def test_cloud_source_snapshot_never_carries_plaintext_authority() -> None:
    assert "access_token" not in source_resolution.CloudSourceSnapshot.__dataclass_fields__
    assert (
        "access_token"
        not in source_resolution.GitHubSourceAuthoritySnapshot.__dataclass_fields__
    )


async def test_manual_source_provider_io_has_no_open_caller_transaction(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(
        db_session, user, anyharness_workspace_id="sandbox-ws-source"
    )
    await _seed_source_authority(db_session, user)
    await db_session.commit()

    async def branch_head(*_args: object, **_kwargs: object) -> str:
        assert not db_session.in_transaction(), "provider I/O held the caller SQL transaction"
        assert inspect(user).expired, "regression requires expire-on-rollback actor state"
        return "4" * 40

    _patch_source(monkeypatch, branch_head)
    run = await compiler.start_run(
        db_session,
        user,
        workflow.id,
        inputs={},
        target_mode="personal_cloud",
        target_workspace_id=workspace.id,
        release_source_snapshot=db_session.rollback,
    )
    assert run.resolved_plan_json["sourceIntent"] == {
        "kind": "remote_commit",
        "repo": "github.com/acme/widgets",
        "ref": "refs/heads/feature/x",
        "resolvedCommit": "4" * 40,
    }


async def test_missing_selected_branch_never_falls_back_to_default(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(
        db_session, user, anyharness_workspace_id="sandbox-ws-source-missing"
    )
    await _seed_source_authority(db_session, user)
    await db_session.commit()

    async def missing(*_args: object, **_kwargs: object) -> str:
        raise GitHubBranchNotFound("missing")

    _patch_source(monkeypatch, missing)
    with pytest.raises(CloudApiError) as caught:
        await compiler.start_run(
            db_session,
            user,
            workflow.id,
            inputs={},
            target_mode="personal_cloud",
            target_workspace_id=workspace.id,
            release_source_snapshot=db_session.rollback,
        )
    assert caught.value.code == "workflow_source_selected_branch_unresolved"


async def test_workspace_archived_during_provider_io_fails_source_fence(
    db_session: AsyncSession,
    test_engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(
        db_session, user, anyharness_workspace_id="sandbox-ws-source-archive"
    )
    workspace_id = workspace.id
    workflow_id = workflow.id
    await _seed_source_authority(db_session, user)
    await db_session.commit()
    factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async def branch_head(*_args: object, **_kwargs: object) -> str:
        async with factory() as concurrent:
            current = await concurrent.get(CloudWorkspace, workspace_id)
            assert current is not None
            current.archived_at = utcnow()
            await concurrent.commit()
        return "6" * 40

    _patch_source(monkeypatch, branch_head)
    with pytest.raises(CloudApiError) as caught:
        await compiler.start_run(
            db_session,
            user,
            workflow_id,
            inputs={},
            target_mode="personal_cloud",
            target_workspace_id=workspace_id,
            release_source_snapshot=db_session.rollback,
        )
    assert caught.value.code == "workflow_source_fence_changed"


async def test_archive_restore_during_provider_io_rotates_source_fence(
    db_session: AsyncSession,
    test_engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(
        db_session, user, anyharness_workspace_id="sandbox-ws-source-restored"
    )
    user_id = user.id
    workflow_id = workflow.id
    workspace_id = workspace.id
    await _seed_source_authority(db_session, user)
    await db_session.commit()
    factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async def branch_head(*_args: object, **_kwargs: object) -> str:
        async with factory() as concurrent:
            current = await cloud_workspace_store.get_cloud_workspace_for_user(
                concurrent, user_id, workspace_id
            )
            assert current is not None and current.generation == 1
            archived = await cloud_workspace_store.archive_cloud_workspace(
                concurrent, current
            )
            restored = await cloud_workspace_store.restore_cloud_workspace(
                concurrent, archived
            )
            assert restored is not None and restored.generation == 3
            await concurrent.commit()
        return "7" * 40

    _patch_source(monkeypatch, branch_head)
    with pytest.raises(CloudApiError) as caught:
        await compiler.start_run(
            db_session,
            user,
            workflow_id,
            inputs={},
            target_mode="personal_cloud",
            target_workspace_id=workspace_id,
            release_source_snapshot=db_session.rollback,
        )
    assert caught.value.code == "workflow_source_fence_changed"


async def test_version_deleted_during_provider_io_returns_typed_source_fence(
    db_session: AsyncSession,
    test_engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(
        db_session, user, anyharness_workspace_id="sandbox-ws-source-version-delete"
    )
    workflow_id = workflow.id
    version_id = workflow.current_version_id
    assert version_id is not None
    await _seed_source_authority(db_session, user)
    await db_session.commit()
    factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async def branch_head(*_args: object, **_kwargs: object) -> str:
        async with factory() as concurrent:
            current = await concurrent.get(Workflow, workflow_id)
            assert current is not None
            current.current_version_id = None
            await concurrent.flush()
            await concurrent.execute(
                delete(WorkflowVersion).where(WorkflowVersion.id == version_id)
            )
            await concurrent.commit()
        return "8" * 40

    _patch_source(monkeypatch, branch_head)
    with pytest.raises(CloudApiError) as caught:
        await compiler.start_run(
            db_session,
            user,
            workflow_id,
            inputs={},
            target_mode="personal_cloud",
            target_workspace_id=workspace.id,
            release_source_snapshot=db_session.rollback,
        )
    assert caught.value.code == "workflow_source_fence_changed"


@pytest.mark.parametrize(
    "revocation",
    [
        "authorization_needs_reauth",
        "installation_suspended",
        "installation_deleted",
        "installation_selection_changed",
        "repository_coverage_deleted",
    ],
)
async def test_github_authority_revoked_during_provider_io_fails_source_fence(
    db_session: AsyncSession,
    test_engine,
    monkeypatch: pytest.MonkeyPatch,
    revocation: str,
) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(
        db_session, user, anyharness_workspace_id=f"sandbox-source-{revocation}"
    )
    authority = await _seed_source_authority(db_session, user)
    await db_session.commit()
    factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async def branch_head(*_args: object, **_kwargs: object) -> str:
        async with factory() as concurrent:
            if revocation == "authorization_needs_reauth":
                await github_app_store.mark_github_app_authorization_needs_reauth(
                    concurrent, authority.authorization_id
                )
            elif revocation == "installation_suspended":
                await github_app_store.set_github_app_installation_suspended(
                    concurrent,
                    github_installation_id=authority.github_installation_id,
                    suspended_at=utcnow(),
                )
            elif revocation == "installation_deleted":
                await github_app_store.mark_github_app_installation_deleted(
                    concurrent,
                    github_installation_id=authority.github_installation_id,
                )
            elif revocation == "installation_selection_changed":
                installation = await concurrent.get(
                    GitHubAppInstallation, authority.installation_id
                )
                assert installation is not None
                installation.repository_selection = "all"
                installation.updated_at = utcnow()
            else:
                await github_app_store.delete_installation_repo_cache(
                    concurrent,
                    installation_id=authority.installation_id,
                    owner="acme",
                    name="widgets",
                )
            await concurrent.commit()
        if revocation == "authorization_needs_reauth":
            raise GitHubBranchNotFound("masked authorization loss")
        return "9" * 40

    _patch_source(monkeypatch, branch_head)
    with pytest.raises(CloudApiError) as caught:
        await compiler.start_run(
            db_session,
            user,
            workflow.id,
            inputs={},
            target_mode="personal_cloud",
            target_workspace_id=workspace.id,
            release_source_snapshot=db_session.rollback,
        )
    assert caught.value.code == "workflow_source_fence_changed"
    assert (
        await db_session.scalar(
            select(WorkflowRun.id).where(WorkflowRun.workflow_id == workflow.id)
        )
        is None
    )


def _traceback_locals(error: BaseException) -> str:
    values: list[str] = []
    traceback = error.__traceback__
    while traceback is not None:
        values.append(repr(traceback.tb_frame.f_locals))
        traceback = traceback.tb_next
    return "\n".join(values)


def _assert_source_token_absent_from_error_surfaces(error: BaseException) -> None:
    traceback_locals = _traceback_locals(error)
    assert "cached-source-token" not in traceback_locals
    event = sentry_integration._scrub_event(
        {"message": repr(error), "extra": {"tracebackLocals": traceback_locals}},
        {},
    )
    assert "cached-source-token" not in json.dumps(event, sort_keys=True)


@pytest.mark.parametrize("release_mode", ["raises", "leaves_transaction_open"])
async def test_source_token_is_absent_from_release_failure_traceback(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    release_mode: str,
) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(
        db_session, user, anyharness_workspace_id=f"sandbox-release-{release_mode}"
    )
    await _seed_source_authority(db_session, user)
    await db_session.commit()

    async def branch_head(*_args: object, **_kwargs: object) -> str:
        raise AssertionError("provider must not run")

    async def release() -> None:
        if release_mode == "raises":
            raise RuntimeError("release failed")

    _patch_source(monkeypatch, branch_head)
    expected = RuntimeError if release_mode == "raises" else CloudApiError
    with pytest.raises(expected) as caught:
        await compiler.start_run(
            db_session,
            user,
            workflow.id,
            inputs={},
            target_mode="personal_cloud",
            target_workspace_id=workspace.id,
            release_source_snapshot=release,
        )
    _assert_source_token_absent_from_error_surfaces(caught.value)


async def test_provider_error_has_no_secret_bearing_exception_chain(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from proliferate.integrations.github import GitHubIntegrationError

    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    workspace = await _make_ready_cloud_workspace(
        db_session, user, anyharness_workspace_id="sandbox-provider-error"
    )
    await _seed_source_authority(db_session, user)
    await db_session.commit()

    async def provider(access_token: str, *_args: object, **_kwargs: object) -> str:
        raise GitHubIntegrationError(f"request retained {access_token}")

    _patch_source(monkeypatch, provider)
    with pytest.raises(CloudApiError) as caught:
        await compiler.start_run(
            db_session,
            user,
            workflow.id,
            inputs={},
            target_mode="personal_cloud",
            target_workspace_id=workspace.id,
            release_source_snapshot=db_session.rollback,
        )
    assert caught.value.code == "workflow_source_provider_failed"
    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None
    _assert_source_token_absent_from_error_surfaces(caught.value)


@pytest.mark.parametrize(
    "trigger_kind", [WORKFLOW_TRIGGER_KIND_SCHEDULE, WORKFLOW_TRIGGER_KIND_POLL]
)
async def test_cloud_trigger_source_cutover_fails_without_committing_outer_state(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    trigger_kind: str,
) -> None:
    user = await _make_user(db_session)
    workflow = await _make_workflow(db_session, user)
    user_id = user.id

    async def unexpected(*_args: object, **_kwargs: object) -> str:
        raise AssertionError("parked cloud triggers must not call the source provider")

    _patch_source(monkeypatch, unexpected)
    with pytest.raises(CloudApiError) as caught:
        async with db_session.begin_nested():
            await compiler.start_run(
                db_session,
                user,
                workflow.id,
                inputs={},
                target_mode="personal_cloud",
                trigger_kind=trigger_kind,
            )
    assert caught.value.code == "workflow_source_trigger_cutover_required"
    assert db_session.in_transaction(), "compiler ended its caller-owned transaction"
    await db_session.rollback()
    assert await db_session.scalar(select(User.id).where(User.id == user_id)) is None
