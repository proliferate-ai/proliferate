"""Session creation and config stages for cloud automations."""

from __future__ import annotations

from typing import cast

from proliferate.db.store.automation_run_claim_transitions import (
    attach_anyharness_session_to_run,
    mark_run_creating_session,
)
from proliferate.db.store.automation_run_claims import (
    ClaimTransitionRule as StoreClaimTransitionRule,
)
from proliferate.server.automations.domain.claim_lifecycle import (
    ANYHARNESS_SESSION_ATTACHMENT_TRANSITION,
    CREATING_SESSION_TRANSITION,
    claim_is_active,
)
from proliferate.server.automations.worker.cloud_execution.command_models import (
    StartSessionPayload,
)
from proliferate.server.automations.worker.cloud_execution.commands import (
    command_wait_timeout,
    enqueue_start_session,
    enqueue_update_session_config,
    wait_for_start_session,
)
from proliferate.server.automations.worker.cloud_execution.context import (
    AutomationExecutionContext,
    SessionExecutionContext,
)
from proliferate.server.automations.worker.cloud_execution.stages.cleanup import (
    close_orphan_session,
)
from proliferate.server.automations.worker.cloud_executor_claims import (
    fail_claim,
    require_current_claim,
)
from proliferate.server.automations.worker.cloud_executor_commands import wait_for_command_result
from proliferate.utils.time import utcnow


def _store_transition(rule: object) -> StoreClaimTransitionRule:
    return cast(StoreClaimTransitionRule, rule)


async def start_session_stage(
    ctx: AutomationExecutionContext,
) -> AutomationExecutionContext | None:
    assert ctx.target is not None
    assert ctx.workspace is not None
    current = await mark_run_creating_session(
        run_id=ctx.claim.id,
        claim_id=ctx.claim.claim_id,
        anyharness_workspace_id=ctx.workspace.anyharness_workspace_id,
        now=utcnow(),
        transition=_store_transition(CREATING_SESSION_TRANSITION),
        claim_is_active=claim_is_active,
    )
    if current is None:
        return None
    if current.anyharness_session_id is not None:
        return ctx.with_claim(current).with_session(
            SessionExecutionContext(anyharness_session_id=current.anyharness_session_id)
        )
    if current.agent_kind is None:
        await fail_claim(current, code="agent_not_configured")
        return None
    try:
        command = await enqueue_start_session(
            ctx.with_claim(current),
            target_id=ctx.target.target_id,
            workspace_id=ctx.workspace.anyharness_workspace_id,
            payload=StartSessionPayload(
                workspace_id=ctx.workspace.anyharness_workspace_id,
                agent_kind=current.agent_kind,
                model_id=current.model_id,
                mode_id=current.mode_id,
                origin={"kind": "system", "entrypoint": "cloud"},
            ),
        )
        result = await wait_for_start_session(
            command,
            timeout=command_wait_timeout(ctx.with_claim(current)),
        )
    except Exception:
        await fail_claim(current, code="session_create_failed")
        return None
    attached = await attach_anyharness_session_to_run(
        run_id=current.id,
        claim_id=current.claim_id,
        anyharness_workspace_id=ctx.workspace.anyharness_workspace_id,
        anyharness_session_id=result.session_id,
        now=utcnow(),
        transition=_store_transition(ANYHARNESS_SESSION_ATTACHMENT_TRANSITION),
        claim_is_active=claim_is_active,
    )
    if not attached:
        await close_orphan_session(ctx.with_claim(current), session_id=result.session_id)
        await fail_claim(current, code="stale_claim")
        return None
    refreshed = await require_current_claim(current)
    if refreshed is None:
        return None
    return ctx.with_claim(refreshed).with_session(
        SessionExecutionContext(anyharness_session_id=result.session_id)
    )


async def apply_session_config_stage(
    ctx: AutomationExecutionContext,
) -> AutomationExecutionContext | None:
    assert ctx.target is not None
    assert ctx.workspace is not None
    assert ctx.session is not None
    if not ctx.claim.reasoning_effort:
        return ctx
    try:
        command = await enqueue_update_session_config(
            ctx,
            target_id=ctx.target.target_id,
            workspace_id=ctx.workspace.anyharness_workspace_id,
            session_id=ctx.session.anyharness_session_id,
            stage="update-reasoning-effort",
            payload={
                "normalizedControl": "effort",
                "value": ctx.claim.reasoning_effort,
            },
        )
        await wait_for_command_result(command, timeout=command_wait_timeout(ctx))
    except Exception:
        await fail_claim(ctx.claim, code="config_apply_failed")
        return None
    refreshed = await require_current_claim(ctx.claim)
    return ctx.with_claim(refreshed) if refreshed is not None else None
