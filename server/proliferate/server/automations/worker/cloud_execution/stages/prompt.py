"""Prompt dispatch stage for cloud automations."""

from __future__ import annotations

from typing import cast

from proliferate.db.store.automation_run_claim_transitions import (
    mark_run_dispatched,
    mark_run_dispatching,
)
from proliferate.db.store.automation_run_claims import (
    ClaimTransitionRule as StoreClaimTransitionRule,
)
from proliferate.server.automations.domain.claim_lifecycle import (
    AUTOMATION_ERROR_DISPATCH_UNCERTAIN,
    DISPATCHED_TRANSITION,
    DISPATCHING_TRANSITION,
    claim_is_active,
)
from proliferate.server.automations.worker.cloud_execution.command_models import (
    SendPromptPayload,
)
from proliferate.server.automations.worker.cloud_execution.commands import (
    automation_prompt_id,
    command_wait_timeout,
    enqueue_send_prompt,
)
from proliferate.server.automations.worker.cloud_execution.context import (
    AutomationExecutionContext,
)
from proliferate.server.automations.worker.cloud_executor_claims import fail_claim
from proliferate.server.automations.worker.cloud_executor_commands import wait_for_command_result
from proliferate.utils.time import utcnow


def _store_transition(rule: object) -> StoreClaimTransitionRule:
    return cast(StoreClaimTransitionRule, rule)


async def dispatch_prompt_stage(ctx: AutomationExecutionContext) -> None:
    assert ctx.target is not None
    assert ctx.workspace is not None
    assert ctx.session is not None
    dispatching = await mark_run_dispatching(
        run_id=ctx.claim.id,
        claim_id=ctx.claim.claim_id,
        now=utcnow(),
        transition=_store_transition(DISPATCHING_TRANSITION),
        claim_is_active=claim_is_active,
    )
    if dispatching is None:
        return
    try:
        command = await enqueue_send_prompt(
            ctx.with_claim(dispatching),
            target_id=ctx.target.target_id,
            workspace_id=ctx.workspace.anyharness_workspace_id,
            session_id=ctx.session.anyharness_session_id,
            payload=SendPromptPayload(
                text=dispatching.prompt,
                prompt_id=automation_prompt_id(ctx.with_claim(dispatching)),
            ),
        )
        await wait_for_command_result(
            command, timeout=command_wait_timeout(ctx.with_claim(dispatching))
        )
    except TimeoutError:
        await fail_claim(dispatching, code=AUTOMATION_ERROR_DISPATCH_UNCERTAIN)
        return
    except Exception:
        await fail_claim(dispatching, code="prompt_send_failed")
        return
    await mark_run_dispatched(
        run_id=dispatching.id,
        claim_id=dispatching.claim_id,
        anyharness_workspace_id=ctx.workspace.anyharness_workspace_id,
        anyharness_session_id=ctx.session.anyharness_session_id,
        now=utcnow(),
        transition=_store_transition(DISPATCHED_TRANSITION),
        claim_is_active=claim_is_active,
    )
