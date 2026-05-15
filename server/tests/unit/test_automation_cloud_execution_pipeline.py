from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast
import uuid

import pytest

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTOR_KIND_CLOUD,
)
from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue
from proliferate.db.store.cloud_sync.commands import CloudCommandSnapshot
from proliferate.server.automations.worker.cloud_execution import pipeline
from proliferate.server.automations.worker.cloud_execution.command_models import SendPromptPayload
from proliferate.server.automations.worker.cloud_execution.commands import (
    parse_start_session_result,
)
from proliferate.server.automations.worker.cloud_execution.context import (
    AutomationExecutionContext,
)
from proliferate.server.automations.worker.cloud_executor_commands import AutomationCommandResult
from proliferate.server.automations.worker.cloud_executor_config import build_cloud_executor_config


def _claim() -> AutomationRunClaimValue:
    return AutomationRunClaimValue(
        id=uuid.uuid4(),
        automation_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        status="claimed",
        execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
        title="Daily check",
        prompt="Check the repo",
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        cloud_target_id_snapshot=None,
        cloud_target_kind_snapshot=None,
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
