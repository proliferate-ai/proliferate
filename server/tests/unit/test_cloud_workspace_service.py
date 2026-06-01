from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.auth.authorization import OwnerContext
from proliferate.constants.billing import (
    WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT,
    WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
)
from proliferate.server.billing.models import SandboxStartAuthorization
from proliferate.server.automations.worker.cloud_executor_commands import AutomationCommandResult
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces import service as workspace_service


def _denied_start_authorization(*, blocked_reason: str) -> SandboxStartAuthorization:
    return SandboxStartAuthorization(
        allowed=False,
        billing_subject_id=uuid4(),
        start_blocked=True,
        start_block_reason=blocked_reason,
        active_spend_hold=blocked_reason != WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT,
        hold_reason=(
            None
            if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT
            else blocked_reason
        ),
        message=(
            "Sandbox limit reached. Archive or delete another cloud workspace before starting "
            "a new one."
            if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT
            else "Cloud usage is paused because your included sandbox hours are exhausted."
        ),
        active_sandbox_count=(
            2 if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT else 0
        ),
        remaining_seconds=0.0,
    )


def _allowed_start_authorization() -> SandboxStartAuthorization:
    return SandboxStartAuthorization(
        allowed=True,
        billing_subject_id=uuid4(),
        start_blocked=False,
        start_block_reason=None,
        active_spend_hold=False,
        hold_reason=None,
        message=None,
        active_sandbox_count=0,
        remaining_seconds=19.0 * 3600.0,
    )


@pytest.mark.asyncio
async def test_org_cloud_workspace_create_fails_before_personal_helpers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    organization_id = uuid4()

    async def _resolve_owner_context(_user, owner_selection, *, db):
        assert db is not None
        assert owner_selection.owner_scope == "organization"
        assert owner_selection.organization_id == organization_id
        return OwnerContext(
            owner_scope="organization",
            actor_user_id=user.id,
            owner_user_id=None,
            organization_id=organization_id,
            membership_id=uuid4(),
            membership_role="owner",
            billing_subject_id=uuid4(),
        )

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("org cloud create must fail before personal cloud helpers")

    monkeypatch.setattr(workspace_service, "resolve_owner_context", _resolve_owner_context)
    monkeypatch.setattr(workspace_service, "get_linked_github_account", _unexpected)
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _unexpected)
    monkeypatch.setattr(workspace_service, "load_repo_config_value", _unexpected)
    monkeypatch.setattr(workspace_service, "_load_personal_agent_auth_agent_kinds", _unexpected)
    monkeypatch.setattr(workspace_service, "create_cloud_workspace_for_user", _unexpected)

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_service.create_cloud_workspace(
            user,
            db=object(),  # type: ignore[arg-type]
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            base_branch="main",
            branch_name="feature/cloud",
            display_name=None,
            owner_selection=workspace_service.OwnerSelection(
                owner_scope="organization",
                organization_id=organization_id,
            ),
        )

    assert exc_info.value.code == "org_cloud_not_ready"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_create_cloud_workspace_blocks_when_billing_snapshot_is_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _existing_workspace(**_kwargs):
        return None

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _denied_start_authorization(
            blocked_reason=WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED
        )

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("downstream workspace creation should not run when billing blocks")

    async def _repo_config_value(**_kwargs):
        return SimpleNamespace(configured=True, env_vars={}, default_branch=None)

    monkeypatch.setattr(workspace_service, "get_linked_github_account", lambda _user: object())
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "load_existing_cloud_workspace", _existing_workspace)
    monkeypatch.setattr(workspace_service, "load_repo_config_value", _repo_config_value)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(workspace_service, "_load_personal_agent_auth_agent_kinds", _unexpected)
    monkeypatch.setattr(workspace_service, "create_cloud_workspace_for_user", _unexpected)

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_service.create_cloud_workspace(
            user,
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            base_branch="main",
            branch_name="feature/cloud",
            display_name=None,
        )

    assert exc_info.value.code == "quota_exceeded"
    assert exc_info.value.status_code == 403
    assert "sandbox hours are exhausted" in exc_info.value.message


@pytest.mark.asyncio
async def test_automation_workspace_requires_selected_agent_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"], default_branch="main")

    async def _existing_workspace(**_kwargs):
        return None

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _billing_snapshot(_billing_subject_id):
        return SimpleNamespace()

    async def _repo_config_value(**_kwargs):
        return SimpleNamespace(configured=True, default_branch="main")

    async def _agent_auth_agent_kinds(_user_id):
        return ("claude",)

    monkeypatch.setattr(workspace_service, "get_linked_github_account", lambda _user: object())
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "load_existing_cloud_workspace", _existing_workspace)
    monkeypatch.setattr(workspace_service, "load_repo_config_value", _repo_config_value)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(workspace_service, "get_billing_snapshot_for_subject", _billing_snapshot)
    monkeypatch.setattr(workspace_service, "repo_limit_for_billing_snapshot", lambda _snapshot: 4)
    monkeypatch.setattr(
        workspace_service,
        "_load_personal_agent_auth_agent_kinds",
        _agent_auth_agent_kinds,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_service._resolve_new_cloud_workspace_create(
            user,
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            base_branch=None,
            branch_name="automation/run-123",
            display_name=None,
            required_agent_kind="codex",
        )

    assert exc_info.value.code == "missing_agent_credentials"
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_automation_workspace_requires_managed_target_and_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("automation workspace must not fall back to legacy creation")

    monkeypatch.setattr(
        workspace_service,
        "_resolve_new_cloud_workspace_create",
        _unexpected,
    )
    monkeypatch.setattr(
        workspace_service,
        "_resolve_new_managed_cloud_workspace_create",
        _unexpected,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_service.create_cloud_workspace_for_automation_run(
            user,  # type: ignore[arg-type]
            run_id=uuid4(),
            claim_id=uuid4(),
            target_id=uuid4(),
            sandbox_profile_id=None,
            git_owner="acme",
            git_repo_name="rocket",
            branch_name="automation/run-123",
            display_name="Automation run",
            required_agent_kind="codex",
        )

    assert exc_info.value.code == "target_required"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_create_cloud_workspace_returns_pending_after_queueing_provision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(id=uuid4(), status=workspace_service.CloudWorkspaceStatus.pending)
    scheduled: list[object] = []
    create_kwargs: dict[str, object] = {}

    async def _resolve_new_cloud_workspace_create(*_args, **_kwargs):
        return workspace_service.ResolvedCloudWorkspaceCreate(
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="feature/cloud",
            git_base_branch="main",
            display_name=None,
            active_sandbox_count=0,
            selected_agent_kinds=("claude",),
            cloud_repo_limit=4,
        )

    async def _create_cloud_workspace_for_user(**_kwargs):
        create_kwargs.update(_kwargs)
        return workspace

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        workspace_service,
        "_resolve_new_cloud_workspace_create",
        _resolve_new_cloud_workspace_create,
    )
    monkeypatch.setattr(
        workspace_service,
        "create_cloud_workspace_for_user",
        _create_cloud_workspace_for_user,
    )
    monkeypatch.setattr(
        workspace_service,
        "get_configured_sandbox_provider",
        lambda: SimpleNamespace(template_version="v1"),
    )
    monkeypatch.setattr(
        workspace_service,
        "schedule_workspace_provision",
        lambda workspace_id: scheduled.append(workspace_id),
    )
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)

    payload = await workspace_service.create_cloud_workspace(
        user,
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        base_branch="main",
        branch_name="feature/cloud",
        display_name=None,
        source="mobile",
    )

    assert payload.status == workspace_service.CloudWorkspaceStatus.pending
    assert scheduled == [workspace.id]
    assert create_kwargs["origin"] == "manual_mobile"
    assert create_kwargs["origin_json"] == '{"kind":"human","entrypoint":"mobile"}'


@pytest.mark.asyncio
async def test_launch_workspace_on_target_keeps_workspace_id_after_expire_all(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    expected_target_id = uuid4()
    expected_workspace_id = uuid4()
    refreshed_workspace = SimpleNamespace(id=expected_workspace_id)
    command_calls: list[dict[str, object]] = []

    class ExpiringWorkspace:
        expired = False

        @property
        def id(self):
            if self.expired:
                raise AssertionError("workspace.id was read after db.expire_all()")
            return expected_workspace_id

    workspace = ExpiringWorkspace()

    class FakeDb:
        def expire_all(self) -> None:
            workspace.expired = True

    async def _get_visible_target_by_id(_db, *, target_id: object, user_id: object):
        assert target_id == expected_target_id
        assert user_id == user.id
        return SimpleNamespace(
            id=expected_target_id,
            owner_scope="personal",
            owner_user_id=user.id,
            kind=workspace_service.CloudTargetKind.desktop_dispatch.value,
            status=workspace_service.CloudTargetStatus.online.value,
            default_workspace_root="/tmp/workspaces",
        )

    async def _resolve_new_direct_target_workspace_create(*_args, **_kwargs):
        return workspace_service.ResolvedCloudWorkspaceCreate(
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="feature/dispatch",
            git_base_branch="main",
            display_name="Dispatch",
            active_sandbox_count=0,
            selected_agent_kinds=("claude",),
            cloud_repo_limit=None,
        )

    async def _ensure_personal_billing_subject(_db, _user_id):
        return SimpleNamespace(id=uuid4())

    async def _create_direct_target_cloud_workspace(_db, **_kwargs):
        return workspace

    async def _commit_session(_db) -> None:
        return None

    async def _enqueue_target_launch_command(_db, **kwargs):
        command = SimpleNamespace(id=uuid4(), kind=kwargs["kind"], payload=kwargs["payload"])
        command_calls.append({**kwargs, "command": command})
        if command.kind == workspace_service.CloudCommandKind.materialize_workspace.value:
            if command.payload["mode"] == "existing_path":
                assert kwargs["cloud_workspace_id"] is None
            else:
                assert kwargs["cloud_workspace_id"] == expected_workspace_id
        else:
            assert kwargs["cloud_workspace_id"] == expected_workspace_id
        return command

    async def _wait_for_target_launch_command(command, *, workspace_id: object):
        assert workspace_id == expected_workspace_id
        if command.kind == workspace_service.CloudCommandKind.materialize_workspace.value:
            if command.payload["mode"] == "existing_path":
                return AutomationCommandResult(
                    command=command,
                    result={
                        "anyharnessWorkspaceId": "repo-root-workspace",
                        "repoRootId": "repo-root",
                        "path": command.payload["path"],
                        "kind": "existing_path",
                    },
                    body={},
                )
            return AutomationCommandResult(
                command=command,
                result={
                    "anyharnessWorkspaceId": "worktree-workspace",
                    "repoRootId": "repo-root",
                    "path": command.payload["targetPath"],
                    "kind": "worktree",
                },
                body={},
            )
        if command.kind == workspace_service.CloudCommandKind.start_session.value:
            return AutomationCommandResult(command=command, result={}, body={"id": "session-1"})
        return AutomationCommandResult(command=command, result={}, body={})

    async def _get_cloud_workspace_by_id(_db, requested_workspace_id):
        assert requested_workspace_id == expected_workspace_id
        return refreshed_workspace

    async def _build_workspace_detail_for_request(_db, workspace):
        assert workspace is refreshed_workspace
        return workspace_service.WorkspaceDetail.model_construct(id=str(expected_workspace_id))

    monkeypatch.setattr(
        workspace_service.targets_store,
        "get_visible_target_by_id",
        _get_visible_target_by_id,
    )
    monkeypatch.setattr(
        workspace_service,
        "_resolve_new_direct_target_workspace_create",
        _resolve_new_direct_target_workspace_create,
    )
    monkeypatch.setattr(
        workspace_service.billing_store,
        "ensure_personal_billing_subject",
        _ensure_personal_billing_subject,
    )
    monkeypatch.setattr(
        workspace_service,
        "create_direct_target_cloud_workspace",
        _create_direct_target_cloud_workspace,
    )
    monkeypatch.setattr(workspace_service.db_engine, "commit_session", _commit_session)
    monkeypatch.setattr(
        workspace_service,
        "_enqueue_target_launch_command",
        _enqueue_target_launch_command,
    )
    monkeypatch.setattr(
        workspace_service,
        "_wait_for_target_launch_command",
        _wait_for_target_launch_command,
    )
    monkeypatch.setattr(
        workspace_service,
        "get_cloud_workspace_by_id",
        _get_cloud_workspace_by_id,
    )
    monkeypatch.setattr(
        workspace_service,
        "_build_workspace_detail_for_request",
        _build_workspace_detail_for_request,
    )

    result = await workspace_service.launch_workspace_on_target(
        FakeDb(),
        user,
        workspace_service.LaunchWorkspaceOnTargetRequest.model_validate(
            {
                "targetId": str(expected_target_id),
                "gitProvider": "github",
                "gitOwner": "acme",
                "gitRepoName": "rocket",
                "branchName": "feature/dispatch",
                "prompt": "hello",
                "agentKind": "claude",
                "source": "mobile",
            }
        ),
    )

    assert result.session_id == "session-1"
    assert result.workspace.id == str(expected_workspace_id)
    assert len(command_calls) == 5
    assert {call["kind"] for call in command_calls} == {
        workspace_service.CloudCommandKind.ensure_repo_checkout.value,
        workspace_service.CloudCommandKind.materialize_workspace.value,
        workspace_service.CloudCommandKind.start_session.value,
        workspace_service.CloudCommandKind.send_prompt.value,
    }


@pytest.mark.asyncio
async def test_target_launch_wait_marks_pending_prompt_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    command_id = uuid4()
    failed_command = SimpleNamespace(
        id=command_id,
        status=workspace_service.CloudCommandStatus.expired.value,
    )
    calls: list[tuple[str, object]] = []

    async def _wait_for_command_result(_command, *, timeout):
        calls.append(("wait", timeout))
        raise TimeoutError("Timed out waiting for cloud command completion.")

    async def _get_command_by_id(_db, requested_command_id):
        assert requested_command_id == command_id
        calls.append(("load", requested_command_id))
        return failed_command

    async def _mark_pending(_db, command):
        assert command is failed_command
        calls.append(("mark", command.id))

    async def _publish(_db, command):
        assert command is failed_command
        calls.append(("publish", command.id))

    async def _commit(_db):
        calls.append(("commit", "db"))

    class FakeSessionFactory:
        def __call__(self):
            return self

        async def __aenter__(self):
            calls.append(("fresh_session", "open"))
            return SimpleNamespace()

        async def __aexit__(self, _exc_type, _exc, _traceback):
            calls.append(("fresh_session", "close"))
            return False

    monkeypatch.setattr(
        workspace_service,
        "wait_for_command_result",
        _wait_for_command_result,
    )
    monkeypatch.setattr(
        workspace_service.command_store,
        "get_command_by_id",
        _get_command_by_id,
    )
    monkeypatch.setattr(
        workspace_service,
        "mark_pending_prompt_interaction_failed_for_command",
        _mark_pending,
    )
    monkeypatch.setattr(
        workspace_service,
        "publish_command_status_after_commit",
        _publish,
    )
    monkeypatch.setattr(
        workspace_service.db_engine,
        "async_session_factory",
        FakeSessionFactory(),
    )
    monkeypatch.setattr(workspace_service.db_engine, "commit_session", _commit)

    with pytest.raises(TimeoutError):
        await workspace_service._wait_for_target_launch_command(
            SimpleNamespace(id=command_id),
            workspace_id=uuid4(),
        )

    assert calls == [
        ("wait", workspace_service.TARGET_LAUNCH_COMMAND_WAIT_TIMEOUT),
        ("fresh_session", "open"),
        ("load", command_id),
        ("mark", command_id),
        ("publish", command_id),
        ("commit", "db"),
        ("fresh_session", "close"),
    ]


@pytest.mark.asyncio
async def test_delete_cloud_workspace_destroys_runtime_before_archiving(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace_id = uuid4()
    workspace = SimpleNamespace(id=workspace_id)
    calls: list[tuple[str, object]] = []

    async def _cloud_workspace_user_can_archive(_user_id, _workspace_id):
        assert _user_id == user_id
        assert _workspace_id == workspace_id
        calls.append(("load", _workspace_id))
        return workspace

    async def _revoke_claim_tokens_for_workspace(_workspace, *, reason: str) -> None:
        assert _workspace is workspace
        calls.append(("revoke", reason))

    async def _destroy_workspace_runtime(_workspace) -> None:
        assert _workspace is workspace
        calls.append(("destroy", _workspace.id))

    async def _delete_cloud_workspace_records_for_workspace(_workspace) -> None:
        assert _workspace is workspace
        calls.append(("archive", _workspace.id))

    monkeypatch.setattr(
        workspace_service,
        "cloud_workspace_user_can_archive",
        _cloud_workspace_user_can_archive,
    )
    monkeypatch.setattr(
        workspace_service,
        "_revoke_claim_tokens_for_workspace",
        _revoke_claim_tokens_for_workspace,
    )
    monkeypatch.setattr(
        workspace_service,
        "_destroy_workspace_runtime",
        _destroy_workspace_runtime,
    )
    monkeypatch.setattr(
        workspace_service,
        "delete_cloud_workspace_records_for_workspace",
        _delete_cloud_workspace_records_for_workspace,
    )

    await workspace_service.delete_cloud_workspace(user_id, workspace_id)

    assert calls == [
        ("load", workspace_id),
        ("revoke", "workspace_deleted"),
        ("destroy", workspace_id),
        ("archive", workspace_id),
    ]


@pytest.mark.asyncio
async def test_archive_cloud_workspace_queues_worker_prune(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace = SimpleNamespace(
        id=uuid4(),
        target_id=uuid4(),
        anyharness_workspace_id="workspace-123",
    )
    enqueued: list[tuple[object, object]] = []

    async def _enqueue_command(_db, *, user, body):
        enqueued.append((user.id, body))

    monkeypatch.setattr(workspace_service, "enqueue_command", _enqueue_command)

    error = await workspace_service._enqueue_archive_prune_command(
        SimpleNamespace(),
        user_id=user_id,
        workspace=workspace,
    )

    assert error is None
    assert len(enqueued) == 1
    actor_id, body = enqueued[0]
    assert actor_id == user_id
    assert body.kind == workspace_service.CloudCommandKind.prune_workspace_worktree.value
    assert body.target_id == workspace.target_id
    assert body.workspace_id == workspace.anyharness_workspace_id
    assert body.cloud_workspace_id == workspace.id
    assert body.payload["reason"] == "archive"


@pytest.mark.asyncio
async def test_restore_cloud_workspace_uses_lifecycle_permission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace_id = uuid4()
    workspace = SimpleNamespace(id=workspace_id, archived_at=object())
    detail = SimpleNamespace(id=str(workspace_id))
    calls: list[tuple[str, object]] = []

    async def _cloud_workspace_user_can_archive_with_db(_db, _user_id, _workspace_id):
        assert _user_id == user_id
        assert _workspace_id == workspace_id
        calls.append(("load_for_lifecycle", _workspace_id))
        return workspace

    async def _restore_cloud_workspace_record(_db, *, workspace: object):
        calls.append(("restore", workspace))
        return workspace

    async def _build_workspace_detail_for_request(_db, _workspace):
        calls.append(("detail", _workspace))
        return detail

    db = SimpleNamespace(commit=lambda: None)

    async def _commit() -> None:
        calls.append(("commit", workspace_id))

    db.commit = _commit

    monkeypatch.setattr(
        workspace_service,
        "cloud_workspace_user_can_archive_with_db",
        _cloud_workspace_user_can_archive_with_db,
    )
    monkeypatch.setattr(
        workspace_service,
        "restore_cloud_workspace_record",
        _restore_cloud_workspace_record,
    )
    monkeypatch.setattr(
        workspace_service,
        "_build_workspace_detail_for_request",
        _build_workspace_detail_for_request,
    )

    result = await workspace_service.restore_cloud_workspace(db, user_id, workspace_id)

    assert result is detail
    assert calls == [
        ("load_for_lifecycle", workspace_id),
        ("restore", workspace),
        ("detail", workspace),
        ("commit", workspace_id),
    ]


@pytest.mark.asyncio
async def test_purge_cloud_workspace_is_idempotent_when_record_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _get_cloud_workspace_by_id(_db, _workspace_id):
        return None

    async def _unexpected(*_args, **_kwargs):
        raise AssertionError("missing workspace purge must not require lifecycle permission")

    monkeypatch.setattr(
        workspace_service,
        "get_cloud_workspace_by_id",
        _get_cloud_workspace_by_id,
    )
    monkeypatch.setattr(
        workspace_service,
        "cloud_workspace_user_can_archive_with_db",
        _unexpected,
    )

    await workspace_service.purge_cloud_workspace(SimpleNamespace(), uuid4(), uuid4())


@pytest.mark.asyncio
async def test_purge_cloud_workspace_requires_archived_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    workspace_id = uuid4()
    workspace = SimpleNamespace(
        id=workspace_id,
        owner_scope="personal",
        archived_at=None,
    )

    async def _get_cloud_workspace_by_id(_db, _workspace_id):
        assert _workspace_id == workspace_id
        return workspace

    async def _cloud_workspace_user_can_archive_with_db(_db, _user_id, _workspace_id):
        assert _user_id == user_id
        assert _workspace_id == workspace_id
        return workspace

    async def _unexpected(*_args, **_kwargs):
        raise AssertionError("active workspace purge must stop before destructive work")

    db = SimpleNamespace(commit=_unexpected)
    monkeypatch.setattr(
        workspace_service,
        "get_cloud_workspace_by_id",
        _get_cloud_workspace_by_id,
    )
    monkeypatch.setattr(
        workspace_service,
        "cloud_workspace_user_can_archive_with_db",
        _cloud_workspace_user_can_archive_with_db,
    )
    monkeypatch.setattr(
        workspace_service,
        "_revoke_claim_tokens_for_workspace",
        _unexpected,
    )
    monkeypatch.setattr(
        workspace_service.command_store,
        "supersede_workspace_commands",
        _unexpected,
    )
    monkeypatch.setattr(
        workspace_service,
        "purge_cloud_workspace_record",
        _unexpected,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_service.purge_cloud_workspace(db, user_id, workspace_id)

    assert exc_info.value.code == "workspace_purge_requires_archive"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_destroy_workspace_runtime_skips_shared_profile_slot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = SimpleNamespace(
        id=uuid4(),
        active_sandbox_id=None,
        status=workspace_service.CloudWorkspaceStatus.ready.value,
        status_detail="Ready",
        updated_at=None,
    )
    calls: list[str] = []

    async def _load_cloud_sandbox_by_id(_sandbox_id):
        raise AssertionError("shared profile slot should not be loaded from workspace destroy")

    async def _persist_workspace_destroy_state(_workspace) -> None:
        assert _workspace is workspace
        calls.append("persist")

    monkeypatch.setattr(
        workspace_service,
        "load_cloud_sandbox_by_id",
        _load_cloud_sandbox_by_id,
    )
    monkeypatch.setattr(
        workspace_service,
        "persist_workspace_destroy_state",
        _persist_workspace_destroy_state,
    )

    await workspace_service._destroy_workspace_runtime(workspace)

    assert calls == ["persist"]
    assert workspace.status == workspace_service.CloudWorkspaceStatus.archived.value


@pytest.mark.asyncio
async def test_ensure_cloud_workspace_replaces_failed_unmaterialized_retry_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    failed_workspace = SimpleNamespace(
        id=uuid4(),
        status=workspace_service.CloudWorkspaceStatus.error.value,
        anyharness_workspace_id=None,
        last_error="mobility destination conflict: destination path already exists",
    )
    created_workspace = SimpleNamespace(id=uuid4())
    archived: list[object] = []
    created: list[dict[str, object]] = []

    async def _load_existing_cloud_workspace(**_kwargs):
        return failed_workspace

    async def _archive_failed(workspace_id):
        archived.append(workspace_id)

    async def _load_repo_config_value(**_kwargs):
        return SimpleNamespace(configured=True)

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _get_billing_snapshot_for_subject(_subject_id):
        return SimpleNamespace()

    def _repo_limit_for_billing_snapshot(_snapshot):
        return 10

    async def _create_cloud_workspace_for_user(**kwargs):
        created.append(kwargs)
        return created_workspace

    monkeypatch.setattr(
        workspace_service,
        "get_linked_github_account",
        lambda _user: SimpleNamespace(),
    )
    monkeypatch.setattr(
        workspace_service,
        "load_existing_cloud_workspace",
        _load_existing_cloud_workspace,
    )
    monkeypatch.setattr(
        workspace_service,
        "_archive_failed_cloud_workspace_for_mobility_retry",
        _archive_failed,
    )
    monkeypatch.setattr(workspace_service, "load_repo_config_value", _load_repo_config_value)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        workspace_service,
        "get_billing_snapshot_for_subject",
        _get_billing_snapshot_for_subject,
    )
    monkeypatch.setattr(
        workspace_service,
        "repo_limit_for_billing_snapshot",
        _repo_limit_for_billing_snapshot,
    )
    monkeypatch.setattr(
        workspace_service,
        "create_cloud_workspace_for_user",
        _create_cloud_workspace_for_user,
    )

    result = await workspace_service.ensure_cloud_workspace_for_existing_branch(
        user,
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        branch_name="feature/cloud",
        display_name="Rocket",
    )

    assert result is created_workspace
    assert archived == [failed_workspace.id]
    assert created
    assert created[0]["git_branch"] == "feature/cloud"
    assert created[0]["display_name"] == "Rocket"


@pytest.mark.asyncio
async def test_ensure_cloud_workspace_reuses_materialized_error_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    existing_workspace = SimpleNamespace(
        id=uuid4(),
        status=workspace_service.CloudWorkspaceStatus.error.value,
        anyharness_workspace_id="workspace-1",
        last_error="agent runtime failed",
    )

    async def _load_existing_cloud_workspace(**_kwargs):
        return existing_workspace

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("materialized error workspace should be reused for start retry")

    monkeypatch.setattr(
        workspace_service,
        "get_linked_github_account",
        lambda _user: SimpleNamespace(),
    )
    monkeypatch.setattr(
        workspace_service,
        "load_existing_cloud_workspace",
        _load_existing_cloud_workspace,
    )
    monkeypatch.setattr(
        workspace_service,
        "_archive_failed_cloud_workspace_for_mobility_retry",
        _unexpected,
    )
    monkeypatch.setattr(
        workspace_service,
        "create_cloud_workspace_for_user",
        _unexpected,
    )

    result = await workspace_service.ensure_cloud_workspace_for_existing_branch(
        user,
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        branch_name="feature/cloud",
        display_name="Rocket",
    )

    assert result is existing_workspace


@pytest.mark.asyncio
async def test_start_cloud_workspace_blocks_when_billing_snapshot_is_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        status="stopped",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
    )

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _denied_start_authorization(
            blocked_reason=WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT
        )

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("workspace start should stop before credential/runtime work")

    monkeypatch.setattr(workspace_service, "cloud_workspace_user_can_interact", _require_workspace)
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(workspace_service, "_load_personal_agent_auth_agent_kinds", _unexpected)
    monkeypatch.setattr(workspace_service, "save_workspace", _unexpected)

    with pytest.raises(CloudApiError) as exc_info:
        await workspace_service.start_cloud_workspace(user, uuid4())

    assert exc_info.value.code == "quota_exceeded"
    assert exc_info.value.status_code == 403
    assert "Sandbox limit reached" in exc_info.value.message


@pytest.mark.asyncio
async def test_start_cloud_workspace_requeues_error_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status=workspace_service.CloudWorkspaceStatus.error.value,
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        runtime_url="https://runtime.invalid",
        runtime_token_ciphertext="ciphertext",
        anyharness_workspace_id="workspace-123",
        last_error="old error",
        status_detail="Error",
        ready_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    saved_statuses: list[tuple[object, object]] = []
    scheduled: list[object] = []

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _agent_auth_agent_kinds(_user_id):
        return ("claude",)

    async def _save_workspace(_workspace):
        saved_statuses.append((_workspace.status, _workspace.last_error))

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        workspace_service,
        "cloud_workspace_user_can_interact",
        _require_workspace,
    )
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        workspace_service,
        "_load_personal_agent_auth_agent_kinds",
        _agent_auth_agent_kinds,
    )
    monkeypatch.setattr(workspace_service, "save_workspace", _save_workspace)
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)
    monkeypatch.setattr(
        workspace_service,
        "schedule_workspace_provision",
        lambda workspace_id, **_kwargs: scheduled.append(workspace_id),
    )

    payload = await workspace_service.start_cloud_workspace(user, workspace.id)

    assert payload.status == workspace_service.CloudWorkspaceStatus.materializing.value
    assert workspace.status == workspace_service.CloudWorkspaceStatus.materializing.value
    assert workspace.last_error is None
    assert saved_statuses == [(workspace_service.CloudWorkspaceStatus.materializing.value, None)]
    assert scheduled == [workspace.id]


@pytest.mark.asyncio
async def test_start_cloud_workspace_requeues_queued_workspace_for_mobility(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status=workspace_service.CloudWorkspaceStatus.pending.value,
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        last_error="stale error",
        ready_at=None,
    )
    scheduled: list[tuple[object, object]] = []
    saved_statuses: list[tuple[object, object]] = []
    refreshed_env_snapshots: list[object] = []

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _agent_auth_agent_kinds(_user_id):
        return ("claude",)

    async def _refresh_repo_env_snapshot_for_workspace(_workspace):
        refreshed_env_snapshots.append(_workspace.id)
        return _workspace

    async def _save_workspace(_workspace):
        saved_statuses.append((_workspace.status, _workspace.last_error))
        return _workspace

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        workspace_service,
        "cloud_workspace_user_can_interact",
        _require_workspace,
    )
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        workspace_service,
        "_load_personal_agent_auth_agent_kinds",
        _agent_auth_agent_kinds,
    )
    monkeypatch.setattr(
        workspace_service,
        "_refresh_repo_env_snapshot_for_workspace",
        _refresh_repo_env_snapshot_for_workspace,
    )
    monkeypatch.setattr(workspace_service, "save_workspace", _save_workspace)
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)
    monkeypatch.setattr(
        workspace_service,
        "schedule_workspace_provision",
        lambda workspace_id, **kwargs: scheduled.append(
            (workspace_id, kwargs.get("requested_base_sha"))
        ),
    )

    payload = await workspace_service.start_cloud_workspace(
        user,
        workspace.id,
        requested_base_sha="abc123",
    )

    assert payload.status == workspace_service.CloudWorkspaceStatus.pending.value
    assert refreshed_env_snapshots == [workspace.id]
    assert saved_statuses == [(workspace_service.CloudWorkspaceStatus.pending.value, None)]
    assert scheduled == [(workspace.id, "abc123")]


@pytest.mark.asyncio
async def test_start_cloud_workspace_returns_ready_workspace_without_requeue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status=workspace_service.CloudWorkspaceStatus.ready.value,
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        runtime_url="https://runtime.invalid",
        runtime_token_ciphertext="ciphertext",
        anyharness_workspace_id="workspace-123",
        last_error=None,
        status_detail="Stopped",
        updated_at=datetime.now(UTC),
        ready_at=datetime.now(UTC),
    )

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _agent_auth_agent_kinds(_user_id):
        return ("claude",)

    async def _unexpected(*_args, **_kwargs) -> None:
        raise AssertionError("ready workspace should not schedule provisioning work")

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        workspace_service,
        "cloud_workspace_user_can_interact",
        _require_workspace,
    )
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        workspace_service,
        "_load_personal_agent_auth_agent_kinds",
        _agent_auth_agent_kinds,
    )
    monkeypatch.setattr(workspace_service, "save_workspace", _unexpected)
    monkeypatch.setattr(workspace_service, "schedule_workspace_provision", _unexpected)
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)

    payload = await workspace_service.start_cloud_workspace(user, workspace.id)

    assert payload.status == workspace_service.CloudWorkspaceStatus.ready.value
    assert workspace.status == workspace_service.CloudWorkspaceStatus.ready.value


@pytest.mark.asyncio
async def test_start_cloud_workspace_requeues_ready_workspace_for_requested_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    workspace = SimpleNamespace(
        id=uuid4(),
        user_id=user.id,
        status=workspace_service.CloudWorkspaceStatus.ready.value,
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/cloud",
        git_base_branch="main",
        runtime_url="https://runtime.invalid",
        runtime_token_ciphertext="ciphertext",
        anyharness_workspace_id="workspace-123",
        last_error="old error",
        status_detail="Ready",
        updated_at=datetime.now(UTC),
        ready_at=datetime.now(UTC),
    )
    scheduled: list[tuple[object, object]] = []
    saved_statuses: list[tuple[object, object, object]] = []

    async def _require_workspace(_user_id, _workspace_id):
        return workspace

    async def _repo_branches(*_args, **_kwargs) -> SimpleNamespace:
        return SimpleNamespace(branches=["main"])

    async def _authorization(**_kwargs) -> SandboxStartAuthorization:
        return _allowed_start_authorization()

    async def _agent_auth_agent_kinds(_user_id):
        return ("claude",)

    async def _save_workspace(_workspace):
        saved_statuses.append((_workspace.status, _workspace.status_detail, _workspace.last_error))
        return _workspace

    async def _build_workspace_detail(_workspace):
        return SimpleNamespace(status=_workspace.status)

    monkeypatch.setattr(
        workspace_service,
        "cloud_workspace_user_can_interact",
        _require_workspace,
    )
    monkeypatch.setattr(workspace_service, "get_github_repo_branches", _repo_branches)
    monkeypatch.setattr(workspace_service, "authorize_sandbox_start", _authorization)
    monkeypatch.setattr(
        workspace_service,
        "_load_personal_agent_auth_agent_kinds",
        _agent_auth_agent_kinds,
    )
    monkeypatch.setattr(workspace_service, "save_workspace", _save_workspace)
    monkeypatch.setattr(workspace_service, "_build_workspace_detail", _build_workspace_detail)
    monkeypatch.setattr(
        workspace_service,
        "schedule_workspace_provision",
        lambda workspace_id, **kwargs: scheduled.append(
            (workspace_id, kwargs.get("requested_base_sha"))
        ),
    )

    payload = await workspace_service.start_cloud_workspace(
        user,
        workspace.id,
        requested_base_sha="a" * 40,
    )

    assert payload.status == workspace_service.CloudWorkspaceStatus.materializing.value
    assert saved_statuses == [
        (
            workspace_service.CloudWorkspaceStatus.materializing.value,
            "Preparing requested revision",
            None,
        )
    ]
    assert scheduled == [(workspace.id, "a" * 40)]
