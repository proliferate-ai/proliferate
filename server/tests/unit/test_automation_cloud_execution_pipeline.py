from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast
import uuid

import pytest

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTOR_KIND_CLOUD,
    AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
    AUTOMATION_TARGET_MODE_SHARED_CLOUD,
)
from proliferate.constants.cloud import CloudTargetKind, CloudTargetStatus
from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue
from proliferate.db.store.cloud_sync.targets import CloudTargetSnapshot
from proliferate.db.store.cloud_sync.commands import CloudCommandSnapshot
from proliferate.server.automations.worker.cloud_execution import pipeline
from proliferate.server.automations.worker.cloud_execution.command_models import SendPromptPayload
from proliferate.server.automations.worker.cloud_execution.commands import (
    parse_start_session_result,
)
from proliferate.server.automations.worker.cloud_execution.context import (
    AutomationExecutionContext,
    SessionExecutionContext,
    TargetExecutionContext,
    WorkspaceExecutionContext,
)
from proliferate.server.automations.worker.cloud_execution.stages import session as session_stage
from proliferate.server.automations.worker.cloud_execution.stages import target as target_stage
from proliferate.server.automations.worker.cloud_executor_commands import AutomationCommandResult
from proliferate.server.automations.worker.cloud_executor_config import build_cloud_executor_config


def _claim(
    *,
    owner_scope: str = "personal",
    owner_user_id: uuid.UUID | None = None,
    organization_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    target_mode: str = AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
    agent_run_config_snapshot_json: dict[str, object] | None = None,
) -> AutomationRunClaimValue:
    config_id = uuid.uuid4()
    resolved_user_id = user_id or owner_user_id or uuid.uuid4()
    snapshot = agent_run_config_snapshot_json or {
        "config_id": str(config_id),
        "agent_kind": "codex",
        "model_id": "gpt-5.4",
        "control_values": {"mode": "code", "effort": "medium"},
    }
    return AutomationRunClaimValue(
        id=uuid.uuid4(),
        automation_id=uuid.uuid4(),
        owner_scope=owner_scope,
        owner_user_id=(
            owner_user_id
            if owner_user_id is not None or owner_scope != "personal"
            else resolved_user_id
        ),
        organization_id=organization_id,
        user_id=resolved_user_id,
        status="claimed",
        execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
        target_mode=target_mode,
        title="Daily check",
        prompt="Check the repo",
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        cloud_target_id_snapshot=None,
        cloud_target_kind_snapshot=None,
        cloud_agent_run_config_id_snapshot=config_id,
        sandbox_profile_id=None,
        cloud_workspace_exposure_id=None,
        agent_run_config_snapshot_json=snapshot,
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
        cloud_workspace_id=None,
        anyharness_workspace_id=None,
        anyharness_session_id=None,
    )


def _target_snapshot(
    *,
    owner_scope: str,
    owner_user_id: uuid.UUID | None,
    organization_id: uuid.UUID | None,
    created_by_user_id: uuid.UUID,
    sandbox_profile_id: uuid.UUID | None = None,
    attach_profile: bool = True,
) -> CloudTargetSnapshot:
    now = datetime.now(UTC)
    return CloudTargetSnapshot(
        id=uuid.uuid4(),
        display_name="Cloud target",
        kind=CloudTargetKind.managed_cloud.value,
        status=CloudTargetStatus.online.value,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
        sandbox_profile_id=(sandbox_profile_id if sandbox_profile_id is not None else uuid.uuid4())
        if attach_profile
        else None,
        profile_target_role="primary",
        default_workspace_root="/workspace",
        update_channel="stable",
        update_generation=0,
        desired_anyharness_version=None,
        desired_worker_version=None,
        desired_supervisor_version=None,
        update_status=None,
        update_status_detail=None,
        update_component=None,
        update_version=None,
        update_reported_at=None,
        current_versions=None,
        archived_at=None,
        created_at=now,
        updated_at=now,
        status_record=None,
        inventory=None,
    )


@pytest.mark.asyncio
async def test_pipeline_calls_cloud_execution_stages_in_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def _stage(
        name: str,
        ctx: AutomationExecutionContext,
        **_kwargs,  # type: ignore[no-untyped-def]
    ) -> AutomationExecutionContext:
        calls.append(name)
        return ctx

    async def _prompt(ctx: AutomationExecutionContext) -> None:
        calls.append("prompt")

    monkeypatch.setattr(
        pipeline,
        "resolve_target_stage",
        lambda ctx: _stage("target", ctx),
    )
    monkeypatch.setattr(
        pipeline,
        "materialize_workspace_stage",
        lambda ctx, *, config: _stage("workspace", ctx, config=config),
    )
    monkeypatch.setattr(
        pipeline,
        "ensure_git_identity_stage",
        lambda ctx: _stage("git", ctx),
    )
    monkeypatch.setattr(
        pipeline,
        "materialize_environment_stage",
        lambda ctx: _stage("environment", ctx),
    )
    monkeypatch.setattr(
        pipeline,
        "start_session_stage",
        lambda ctx: _stage("session", ctx),
    )
    monkeypatch.setattr(
        pipeline,
        "apply_session_config_stage",
        lambda ctx: _stage("config", ctx),
    )
    monkeypatch.setattr(pipeline, "dispatch_prompt_stage", _prompt)

    result = await pipeline.run_automation_pipeline(
        AutomationExecutionContext(claim=_claim()),
        config=build_cloud_executor_config(executor_id="test"),
    )

    assert result is not None
    assert calls == ["target", "git", "workspace", "environment", "session", "config", "prompt"]


def test_shared_cloud_target_resolution_requires_matching_org_target() -> None:
    actor_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    other_org_id = uuid.uuid4()
    ctx = AutomationExecutionContext(
        claim=_claim(
            owner_scope="organization",
            owner_user_id=None,
            organization_id=organization_id,
            user_id=actor_id,
            target_mode=AUTOMATION_TARGET_MODE_SHARED_CLOUD,
        )
    )

    assert target_stage._target_matches_run_scope(
        _target_snapshot(
            owner_scope="organization",
            owner_user_id=None,
            organization_id=organization_id,
            created_by_user_id=actor_id,
        ),
        ctx,
    )
    assert not target_stage._target_matches_run_scope(
        _target_snapshot(
            owner_scope="organization",
            owner_user_id=None,
            organization_id=other_org_id,
            created_by_user_id=actor_id,
        ),
        ctx,
    )
    assert not target_stage._target_matches_run_scope(
        _target_snapshot(
            owner_scope="personal",
            owner_user_id=actor_id,
            organization_id=None,
            created_by_user_id=actor_id,
        ),
        ctx,
    )


def test_personal_cloud_target_resolution_requires_personal_user_target() -> None:
    actor_id = uuid.uuid4()
    other_user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    ctx = AutomationExecutionContext(
        claim=_claim(
            owner_scope="personal",
            owner_user_id=actor_id,
            organization_id=None,
            user_id=actor_id,
            target_mode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
        )
    )

    assert target_stage._target_matches_run_scope(
        _target_snapshot(
            owner_scope="personal",
            owner_user_id=actor_id,
            organization_id=None,
            created_by_user_id=other_user_id,
        ),
        ctx,
    )
    assert target_stage._target_matches_run_scope(
        _target_snapshot(
            owner_scope="personal",
            owner_user_id=None,
            organization_id=None,
            created_by_user_id=actor_id,
        ),
        ctx,
    )
    assert not target_stage._target_matches_run_scope(
        _target_snapshot(
            owner_scope="organization",
            owner_user_id=None,
            organization_id=organization_id,
            created_by_user_id=actor_id,
        ),
        ctx,
    )


@pytest.mark.asyncio
async def test_resolve_target_stage_fails_when_managed_target_has_no_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    actor_id = uuid.uuid4()
    ctx = AutomationExecutionContext(
        claim=_claim(
            owner_scope="personal",
            owner_user_id=actor_id,
            organization_id=None,
            user_id=actor_id,
            target_mode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
        )
    )
    target = _target_snapshot(
        owner_scope="personal",
        owner_user_id=actor_id,
        organization_id=None,
        created_by_user_id=actor_id,
        attach_profile=False,
    )
    failed_codes: list[str] = []

    async def load_target(_ctx: AutomationExecutionContext) -> CloudTargetSnapshot:
        return target

    async def fail_claim(claim: object, *, code: str, **_kwargs: object) -> None:
        failed_codes.append(code)

    async def unexpected_attach(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("target without a sandbox profile must not attach to the run")

    monkeypatch.setattr(target_stage, "_load_or_select_target", load_target)
    monkeypatch.setattr(target_stage, "fail_claim", fail_claim)
    monkeypatch.setattr(
        target_stage,
        "attach_cloud_target_snapshot_to_run",
        unexpected_attach,
    )

    result = await target_stage.resolve_target_stage(ctx)

    assert result is None
    assert failed_codes == ["sandbox_profile_required"]


def test_automation_worker_has_no_direct_anyharness_runtime_imports() -> None:
    worker_root = (
        Path(__file__).resolve().parents[2] / "proliferate" / "server" / "automations" / "worker"
    )
    haystack = "\n".join(path.read_text() for path in worker_root.rglob("*.py"))

    assert "proliferate.integrations.anyharness.sessions" not in haystack
    assert "proliferate.server.cloud.runtime.anyharness_api" not in haystack
    assert "get_workspace_connection" not in haystack
    assert "provision_workspace" not in haystack


def test_automation_cloud_commands_use_supported_anyharness_origin() -> None:
    worker_root = (
        Path(__file__).resolve().parents[2]
        / "proliferate"
        / "server"
        / "automations"
        / "worker"
        / "cloud_execution"
    )
    haystack = "\n".join(path.read_text() for path in worker_root.rglob("*.py"))

    assert '"entrypoint": "automation"' not in haystack
    assert '"entrypoint": "cloud"' in haystack


def test_send_prompt_payload_includes_stable_prompt_id() -> None:
    payload = SendPromptPayload(
        text="Check the repo.",
        prompt_id="automation-run:run-1:send-prompt",
    )

    assert payload.to_json() == {
        "promptId": "automation-run:run-1:send-prompt",
        "blocks": [{"type": "text", "text": "Check the repo."}],
    }


def test_parse_start_session_result_accepts_typed_session_id() -> None:
    result = AutomationCommandResult(
        command=cast(CloudCommandSnapshot, None),
        result={"sessionId": "sess_typed"},
        body={},
    )

    parsed = parse_start_session_result(result)

    assert parsed.session_id == "sess_typed"


def _session_config_ctx() -> AutomationExecutionContext:
    target_id = uuid.uuid4()
    return AutomationExecutionContext(
        claim=_claim(),
        target=TargetExecutionContext(
            target_id=target_id,
            target_kind="managed_cloud",
            default_workspace_root="/workspace",
            organization_id=None,
            status="online",
            sandbox_profile_id=uuid.uuid4(),
        ),
        workspace=WorkspaceExecutionContext(
            cloud_workspace_id=uuid.uuid4(),
            anyharness_workspace_id="workspace-1",
            anyharness_repo_root_id="repo-root-1",
            path="/workspace/proliferate",
            branch="main",
        ),
        session=SessionExecutionContext(anyharness_session_id="session-1"),
    )


@pytest.mark.asyncio
async def test_apply_session_config_requires_applied_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _session_config_ctx()
    failed_codes: list[str] = []

    async def enqueue_config(*_args: object, **_kwargs: object) -> CloudCommandSnapshot:
        return cast(CloudCommandSnapshot, object())

    async def wait_for_result(
        command: CloudCommandSnapshot,
        *,
        timeout: timedelta,
    ) -> AutomationCommandResult:
        return AutomationCommandResult(command=command, result={}, body={"applyState": "queued"})

    async def fail_claim(_claim: object, *, code: str, **_kwargs: object) -> None:
        failed_codes.append(code)

    monkeypatch.setattr(session_stage, "enqueue_update_session_config", enqueue_config)
    monkeypatch.setattr(session_stage, "wait_for_command_result", wait_for_result)
    monkeypatch.setattr(session_stage, "fail_claim", fail_claim)

    result = await session_stage.apply_session_config_stage(ctx)

    assert result is None
    assert failed_codes == ["config_apply_failed"]


@pytest.mark.asyncio
async def test_apply_session_config_continues_after_applied_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _session_config_ctx()

    async def enqueue_config(*_args: object, **_kwargs: object) -> CloudCommandSnapshot:
        return cast(CloudCommandSnapshot, object())

    async def wait_for_result(
        command: CloudCommandSnapshot,
        *,
        timeout: timedelta,
    ) -> AutomationCommandResult:
        return AutomationCommandResult(command=command, result={}, body={"applyState": "applied"})

    async def require_claim(claim: AutomationRunClaimValue) -> AutomationRunClaimValue:
        return claim

    async def fail_claim(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("applied config should not fail the claim")

    monkeypatch.setattr(session_stage, "enqueue_update_session_config", enqueue_config)
    monkeypatch.setattr(session_stage, "wait_for_command_result", wait_for_result)
    monkeypatch.setattr(session_stage, "require_current_claim", require_claim)
    monkeypatch.setattr(session_stage, "fail_claim", fail_claim)

    result = await session_stage.apply_session_config_stage(ctx)

    assert result is not None


@pytest.mark.asyncio
async def test_apply_session_config_applies_all_non_launch_controls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _session_config_ctx().with_claim(
        _claim(
            agent_run_config_snapshot_json={
                "config_id": str(uuid.uuid4()),
                "agent_kind": "codex",
                "model_id": "gpt-5.4",
                "control_values": {
                    "mode": "code",
                    "effort": "high",
                    "fast_mode": "enabled",
                },
            }
        )
    )
    payloads: list[dict[str, str]] = []

    async def enqueue_config(*_args: object, **kwargs: object) -> CloudCommandSnapshot:
        payload = kwargs["payload"]
        assert isinstance(payload, dict)
        payloads.append(cast(dict[str, str], payload))
        return cast(CloudCommandSnapshot, object())

    async def wait_for_result(
        command: CloudCommandSnapshot,
        *,
        timeout: timedelta,
    ) -> AutomationCommandResult:
        return AutomationCommandResult(command=command, result={}, body={"applyState": "applied"})

    async def require_claim(claim: AutomationRunClaimValue) -> AutomationRunClaimValue:
        return claim

    monkeypatch.setattr(session_stage, "enqueue_update_session_config", enqueue_config)
    monkeypatch.setattr(session_stage, "wait_for_command_result", wait_for_result)
    monkeypatch.setattr(session_stage, "require_current_claim", require_claim)

    result = await session_stage.apply_session_config_stage(ctx)

    assert result is not None
    assert payloads == [
        {"normalizedControl": "effort", "value": "high"},
        {"normalizedControl": "fast_mode", "value": "enabled"},
    ]
