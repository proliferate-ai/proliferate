from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import cast
import uuid

import pytest

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTOR_KIND_CLOUD,
    AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
)
from proliferate.constants.cloud import CloudTargetKind, CloudTargetStatus
from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue
from proliferate.db.store.cloud_sync.command_records import CloudCommandSnapshot
from proliferate.server.automations.worker.cloud_execution.command_models import (
    MaterializeWorkspaceResult,
)
from proliferate.server.automations.worker.cloud_execution.context import (
    AutomationExecutionContext,
    TargetExecutionContext,
)
from proliferate.server.automations.worker.cloud_execution.stages import (
    workspace as workspace_stage,
)
from proliferate.server.automations.worker.cloud_executor_config import (
    build_cloud_executor_config,
)


def _claim(*, cloud_workspace_id: uuid.UUID) -> AutomationRunClaimValue:
    user_id = uuid.uuid4()
    return AutomationRunClaimValue(
        id=uuid.uuid4(),
        automation_id=uuid.uuid4(),
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
        user_id=user_id,
        status="claimed",
        execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
        target_mode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
        title="Daily check",
        prompt="Check the repo",
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        cloud_target_id_snapshot=None,
        cloud_target_kind_snapshot=None,
        cloud_agent_run_config_id_snapshot=uuid.uuid4(),
        sandbox_profile_id=None,
        cloud_workspace_exposure_id=None,
        agent_run_config_snapshot_json={
            "agent_kind": "codex",
            "model_id": "gpt-5.4",
            "control_values": {"mode": "code"},
        },
        cascade_attempt=0,
        last_cascade_command_id=None,
        last_cascade_reason=None,
        agent_kind="codex",
        model_id="gpt-5.4",
        mode_id="code",
        reasoning_effort="medium",
        executor_kind=AUTOMATION_EXECUTOR_KIND_CLOUD,
        executor_id="cloud:worker",
        claim_id=uuid.uuid4(),
        claim_expires_at=datetime.now(UTC) + timedelta(minutes=5),
        cloud_workspace_id=cloud_workspace_id,
        anyharness_workspace_id=None,
        anyharness_session_id=None,
    )


@pytest.mark.asyncio
async def test_workspace_materialization_scopes_only_worktree_command(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cloud_workspace_id = uuid.uuid4()
    claim = _claim(cloud_workspace_id=cloud_workspace_id)
    ctx = AutomationExecutionContext(
        claim=claim,
        target=TargetExecutionContext(
            target_id=uuid.uuid4(),
            target_kind=CloudTargetKind.managed_cloud.value,
            default_workspace_root="/workspace",
            organization_id=None,
            sandbox_profile_id=uuid.uuid4(),
            status=CloudTargetStatus.online.value,
        ),
    )
    materialize_calls: list[dict[str, object]] = []

    class FakeDb:
        async def __aenter__(self) -> FakeDb:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        def begin(self) -> FakeDb:
            return self

    async def create_workspace_record(
        ctx: AutomationExecutionContext,
        *,
        config: object,
    ) -> AutomationExecutionContext:
        del config
        return ctx

    async def mark_provisioning_workspace(**_kwargs: object) -> AutomationRunClaimValue:
        return claim

    async def get_workspace(*_args: object, **_kwargs: object) -> object:
        return SimpleNamespace(
            git_branch="proliferate/otter",
            git_base_branch="main",
            worktree_path=None,
        )

    async def enqueue_checkout(*_args: object, **_kwargs: object) -> CloudCommandSnapshot:
        return cast(CloudCommandSnapshot, "checkout")

    async def wait_checkout(*_args: object, **_kwargs: object) -> None:
        return None

    async def enqueue_materialize(
        *_args: object,
        **kwargs: object,
    ) -> CloudCommandSnapshot:
        materialize_calls.append(kwargs)
        return cast(CloudCommandSnapshot, kwargs["stage"])

    async def wait_materialize(
        command: CloudCommandSnapshot,
        **_kwargs: object,
    ) -> MaterializeWorkspaceResult:
        if command == "materialize-workspace:repo-root":
            return MaterializeWorkspaceResult(
                anyharness_workspace_id="workspace-root",
                repo_root_id="repo-root-1",
                path="/workspace/proliferate-ai/proliferate",
                kind="local",
                current_branch="main",
            )
        return MaterializeWorkspaceResult(
            anyharness_workspace_id="workspace-worktree",
            repo_root_id="repo-root-1",
            path="/workspace/proliferate-ai/proliferate/worktrees/proliferate-otter",
            kind="worktree",
            current_branch="proliferate/otter",
        )

    async def attach_run(**_kwargs: object) -> AutomationRunClaimValue:
        return replace(claim, anyharness_workspace_id="workspace-worktree")

    async def attach_workspace_id(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(workspace_stage, "_create_workspace_record", create_workspace_record)
    monkeypatch.setattr(
        workspace_stage, "mark_run_provisioning_workspace", mark_provisioning_workspace
    )
    monkeypatch.setattr(workspace_stage.db_engine, "async_session_factory", lambda: FakeDb())
    monkeypatch.setattr(workspace_stage, "get_cloud_workspace_by_id", get_workspace)
    monkeypatch.setattr(workspace_stage, "enqueue_ensure_repo_checkout", enqueue_checkout)
    monkeypatch.setattr(workspace_stage, "wait_for_ensure_repo_checkout", wait_checkout)
    monkeypatch.setattr(workspace_stage, "enqueue_materialize_workspace", enqueue_materialize)
    monkeypatch.setattr(workspace_stage, "wait_for_materialize_workspace", wait_materialize)
    monkeypatch.setattr(workspace_stage, "attach_anyharness_workspace_to_run", attach_run)
    monkeypatch.setattr(workspace_stage, "attach_anyharness_workspace_id", attach_workspace_id)

    result = await workspace_stage.materialize_workspace_stage(
        ctx,
        config=build_cloud_executor_config(executor_id="test"),
    )

    assert result is not None
    assert [call["stage"] for call in materialize_calls] == [
        "materialize-workspace:repo-root",
        "materialize-workspace:worktree",
    ]
    assert materialize_calls[0]["cloud_workspace_id"] is None
    assert materialize_calls[1]["cloud_workspace_id"] == cloud_workspace_id
