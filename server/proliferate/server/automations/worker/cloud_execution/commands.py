"""CloudCommand helper layer for automation execution stages."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from proliferate.constants.cloud import CloudCommandKind
from proliferate.db.store.cloud_sync.commands import CloudCommandSnapshot
from proliferate.server.automations.worker.cloud_execution.command_models import (
    EnsureRepoCheckoutPayload,
    EnsureRepoCheckoutResult,
    MaterializeWorkspacePayload,
    MaterializeWorkspaceResult,
    SendPromptPayload,
    StartSessionPayload,
    StartSessionResult,
    optional_string,
    require_string,
)
from proliferate.server.automations.worker.cloud_execution.context import (
    AutomationExecutionContext,
)
from proliferate.server.automations.worker.cloud_executor_commands import (
    AutomationCommandResult,
    enqueue_automation_command,
    wait_for_command_result,
)

MAX_COMMAND_WAIT_TIMEOUT = timedelta(seconds=240)


def command_wait_timeout(_ctx: AutomationExecutionContext) -> timedelta:
    return MAX_COMMAND_WAIT_TIMEOUT


def _target_organization_id(ctx: AutomationExecutionContext) -> UUID | None:
    return ctx.target.organization_id if ctx.target is not None else None


async def enqueue_materialize_workspace(
    ctx: AutomationExecutionContext,
    *,
    target_id: UUID,
    stage: str,
    payload: MaterializeWorkspacePayload,
    cloud_workspace_id: UUID | None = None,
) -> CloudCommandSnapshot:
    return await enqueue_automation_command(
        ctx.claim,
        target_id=target_id,
        organization_id=_target_organization_id(ctx),
        stage=stage,
        kind=CloudCommandKind.materialize_workspace.value,
        payload=payload.to_json(),
        cloud_workspace_id=cloud_workspace_id,
    )


async def enqueue_ensure_repo_checkout(
    ctx: AutomationExecutionContext,
    *,
    target_id: UUID,
    payload: EnsureRepoCheckoutPayload,
) -> CloudCommandSnapshot:
    return await enqueue_automation_command(
        ctx.claim,
        target_id=target_id,
        organization_id=_target_organization_id(ctx),
        stage="ensure-repo-checkout",
        kind=CloudCommandKind.ensure_repo_checkout.value,
        payload=payload.to_json(),
    )


async def wait_for_ensure_repo_checkout(
    command: CloudCommandSnapshot,
    *,
    timeout: timedelta,
) -> EnsureRepoCheckoutResult:
    result = await wait_for_command_result(command, timeout=timeout)
    payload = result.result
    return EnsureRepoCheckoutResult(
        path=require_string(payload, "path", source="ensure_repo_checkout result"),
        provider=require_string(payload, "provider", source="ensure_repo_checkout result"),
        owner=require_string(payload, "owner", source="ensure_repo_checkout result"),
        name=require_string(payload, "name", source="ensure_repo_checkout result"),
        current_head=optional_string(payload, "currentHead"),
        base_branch=optional_string(payload, "baseBranch"),
    )


async def wait_for_materialize_workspace(
    command: CloudCommandSnapshot,
    *,
    timeout: timedelta,
) -> MaterializeWorkspaceResult:
    result = await wait_for_command_result(command, timeout=timeout)
    return parse_materialize_workspace_result(result)


def parse_materialize_workspace_result(
    result: AutomationCommandResult,
) -> MaterializeWorkspaceResult:
    payload = result.result
    return MaterializeWorkspaceResult(
        anyharness_workspace_id=require_string(
            payload,
            "anyharnessWorkspaceId",
            source="materialize_workspace result",
        ),
        repo_root_id=require_string(payload, "repoRootId", source="materialize_workspace result"),
        path=require_string(payload, "path", source="materialize_workspace result"),
        kind=require_string(payload, "kind", source="materialize_workspace result"),
        current_branch=optional_string(payload, "currentBranch"),
    )


async def enqueue_start_session(
    ctx: AutomationExecutionContext,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID,
    workspace_id: str,
    payload: StartSessionPayload,
) -> CloudCommandSnapshot:
    return await enqueue_automation_command(
        ctx.claim,
        target_id=target_id,
        organization_id=_target_organization_id(ctx),
        stage="start-session",
        kind=CloudCommandKind.start_session.value,
        workspace_id=workspace_id,
        cloud_workspace_id=cloud_workspace_id,
        payload=payload.to_json(),
    )


async def wait_for_start_session(
    command: CloudCommandSnapshot,
    *,
    timeout: timedelta,
) -> StartSessionResult:
    result = await wait_for_command_result(command, timeout=timeout)
    return parse_start_session_result(result)


def parse_start_session_result(result: AutomationCommandResult) -> StartSessionResult:
    session_id = optional_string(result.result, "sessionId")
    if session_id is None:
        session_id = optional_string(result.result, "session_id")
    if session_id is None:
        session_id = optional_string(result.body, "sessionId")
    if session_id is None:
        session_id = optional_string(result.body, "session_id")
    if session_id is None:
        session_id = optional_string(result.body, "id")
    if session_id is None:
        session = result.body.get("session")
        if isinstance(session, dict):
            session_id = optional_string(session, "id")
    if session_id is None:
        raise ValueError("start_session result is missing session id.")
    return StartSessionResult(session_id=session_id)


def automation_prompt_id(ctx: AutomationExecutionContext) -> str:
    return f"automation-run:{ctx.claim.id}:send-prompt"


async def enqueue_update_session_config(
    ctx: AutomationExecutionContext,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID,
    workspace_id: str,
    session_id: str,
    stage: str,
    payload: dict[str, object],
) -> CloudCommandSnapshot:
    return await enqueue_automation_command(
        ctx.claim,
        target_id=target_id,
        organization_id=_target_organization_id(ctx),
        stage=stage,
        kind=CloudCommandKind.update_session_config.value,
        workspace_id=workspace_id,
        cloud_workspace_id=cloud_workspace_id,
        session_id=session_id,
        payload=payload,
    )


async def enqueue_send_prompt(
    ctx: AutomationExecutionContext,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID,
    workspace_id: str,
    session_id: str,
    payload: SendPromptPayload,
) -> CloudCommandSnapshot:
    return await enqueue_automation_command(
        ctx.claim,
        target_id=target_id,
        organization_id=_target_organization_id(ctx),
        stage="send-prompt",
        kind=CloudCommandKind.send_prompt.value,
        workspace_id=workspace_id,
        cloud_workspace_id=cloud_workspace_id,
        session_id=session_id,
        payload=payload.to_json(),
    )
