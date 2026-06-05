from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.server.automations.worker.cloud_executor_commands import AutomationCommandResult
from proliferate.server.cloud.workspaces.models import WorkspaceDetail
from proliferate.server.cloud.workspaces.target_launch import models as target_launch_models
from proliferate.server.cloud.workspaces.target_launch import service as target_launch_service


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
            kind=target_launch_service.CloudTargetKind.desktop_dispatch.value,
            status=target_launch_service.CloudTargetStatus.online.value,
            default_workspace_root="/tmp/workspaces",
        )

    async def _resolve_new_direct_target_workspace_create(*_args, **_kwargs):
        return target_launch_service.ResolvedDirectTargetWorkspaceCreate(
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
        if command.kind == target_launch_service.CloudCommandKind.materialize_workspace.value:
            if command.payload["mode"] == "existing_path":
                assert kwargs["cloud_workspace_id"] is None
            else:
                assert kwargs["cloud_workspace_id"] == expected_workspace_id
        else:
            assert kwargs["cloud_workspace_id"] == expected_workspace_id
        return command

    async def _wait_for_target_launch_command(command, *, workspace_id: object):
        assert workspace_id == expected_workspace_id
        if command.kind == target_launch_service.CloudCommandKind.materialize_workspace.value:
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
        if command.kind == target_launch_service.CloudCommandKind.start_session.value:
            return AutomationCommandResult(command=command, result={}, body={"id": "session-1"})
        return AutomationCommandResult(command=command, result={}, body={})

    async def _get_cloud_workspace_by_id(_db, requested_workspace_id):
        assert requested_workspace_id == expected_workspace_id
        return refreshed_workspace

    async def _build_workspace_detail_for_request(_db, workspace):
        assert workspace is refreshed_workspace
        return WorkspaceDetail.model_construct(id=str(expected_workspace_id))

    monkeypatch.setattr(
        target_launch_service.targets_store,
        "get_visible_target_by_id",
        _get_visible_target_by_id,
    )
    monkeypatch.setattr(
        target_launch_service,
        "_resolve_new_direct_target_workspace_create",
        _resolve_new_direct_target_workspace_create,
    )
    monkeypatch.setattr(
        target_launch_service.billing_store,
        "ensure_personal_billing_subject",
        _ensure_personal_billing_subject,
    )
    monkeypatch.setattr(
        target_launch_service,
        "create_direct_target_cloud_workspace",
        _create_direct_target_cloud_workspace,
    )
    monkeypatch.setattr(
        target_launch_service.db_session.db_engine, "commit_session", _commit_session
    )
    monkeypatch.setattr(
        target_launch_service,
        "_enqueue_target_launch_command",
        _enqueue_target_launch_command,
    )
    monkeypatch.setattr(
        target_launch_service,
        "_wait_for_target_launch_command",
        _wait_for_target_launch_command,
    )
    monkeypatch.setattr(
        target_launch_service,
        "get_cloud_workspace_by_id",
        _get_cloud_workspace_by_id,
    )
    monkeypatch.setattr(
        target_launch_service,
        "build_workspace_detail_for_request",
        _build_workspace_detail_for_request,
    )

    result = await target_launch_service.launch_workspace_on_target(
        FakeDb(),
        user,
        target_launch_models.LaunchWorkspaceOnTargetRequest.model_validate(
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
        target_launch_service.CloudCommandKind.ensure_repo_checkout.value,
        target_launch_service.CloudCommandKind.materialize_workspace.value,
        target_launch_service.CloudCommandKind.start_session.value,
        target_launch_service.CloudCommandKind.send_prompt.value,
    }


@pytest.mark.asyncio
async def test_target_launch_wait_marks_pending_prompt_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    command_id = uuid4()
    failed_command = SimpleNamespace(
        id=command_id,
        status=target_launch_service.CloudCommandStatus.expired.value,
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

    class FakeFreshSession(SimpleNamespace):
        async def close(self):
            calls.append(("fresh_session", "close"))

        async def rollback(self):
            calls.append(("fresh_session", "rollback"))

    class FakeSessionFactory:
        def __call__(self):
            calls.append(("fresh_session", "open"))
            return FakeFreshSession()

    monkeypatch.setattr(
        target_launch_service,
        "wait_for_command_result",
        _wait_for_command_result,
    )
    monkeypatch.setattr(
        target_launch_service.command_store,
        "get_command_by_id",
        _get_command_by_id,
    )
    monkeypatch.setattr(
        target_launch_service,
        "mark_pending_prompt_interaction_failed_for_command",
        _mark_pending,
    )
    monkeypatch.setattr(
        target_launch_service,
        "publish_command_status_after_commit",
        _publish,
    )
    monkeypatch.setattr(
        target_launch_service.db_session.db_engine,
        "async_session_factory",
        FakeSessionFactory(),
    )
    monkeypatch.setattr(target_launch_service.db_session.db_engine, "commit_session", _commit)

    with pytest.raises(TimeoutError):
        await target_launch_service._wait_for_target_launch_command(
            SimpleNamespace(id=command_id),
            workspace_id=uuid4(),
        )

    assert calls == [
        ("wait", target_launch_service.TARGET_LAUNCH_COMMAND_WAIT_TIMEOUT),
        ("fresh_session", "open"),
        ("load", command_id),
        ("mark", command_id),
        ("publish", command_id),
        ("commit", "db"),
        ("fresh_session", "close"),
    ]
