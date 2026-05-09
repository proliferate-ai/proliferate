"""Session and prompt stages for cloud automation execution."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from proliferate.db.store.automation_run_claim_values import (
    AUTOMATION_ERROR_DISPATCH_UNCERTAIN,
    AutomationRunClaimValue,
)
from proliferate.db.store.automation_run_claims import (
    attach_anyharness_session_to_run,
    mark_run_creating_session,
    mark_run_dispatched,
    mark_run_dispatching,
)
from proliferate.db.store.cloud_workspaces import load_cloud_workspace_by_id
from proliferate.integrations.anyharness import (
    CloudRuntimePromptDeliveryUncertainError,
    CloudRuntimeReconnectError,
    CloudRuntimeRequestRejectedError,
    apply_runtime_reasoning_effort,
    close_runtime_session,
    create_runtime_session,
    prompt_runtime_session,
)
from proliferate.server.automations.worker.cloud_executor_claims import (
    fail_claim,
    require_current_claim,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime.models import RuntimeConnectionTarget
from proliferate.server.cloud.runtime.service import get_workspace_connection
from proliferate.utils.time import utcnow

logger = logging.getLogger("proliferate.server.automations.worker.cloud_executor")


@dataclass(frozen=True)
class CloudRunSessionContext:
    claim: AutomationRunClaimValue
    target: RuntimeConnectionTarget


async def create_or_load_session(
    claim: AutomationRunClaimValue,
) -> CloudRunSessionContext | None:
    if claim.cloud_workspace_id is None:
        return None
    workspace = await load_cloud_workspace_by_id(claim.cloud_workspace_id)
    if workspace is None:
        await fail_claim(claim, code="workspace_missing")
        return None
    if workspace.user_id != claim.user_id:
        logger.error(
            "automation cloud executor workspace ownership mismatch run_id=%s "
            "workspace_id=%s run_user_id=%s workspace_user_id=%s",
            claim.id,
            claim.cloud_workspace_id,
            claim.user_id,
            workspace.user_id,
        )
        await fail_claim(claim, code="workspace_ownership_mismatch")
        return None

    try:
        target = await get_workspace_connection(workspace)
    except CloudApiError as exc:
        await fail_claim(claim, code=exc.code, message=exc.message)
        return None
    except CloudRuntimeReconnectError:
        logger.exception("automation cloud executor runtime connection failed run_id=%s", claim.id)
        await fail_claim(claim, code="runtime_not_ready")
        return None

    if claim.agent_kind not in target.ready_agent_kinds:
        await fail_claim(claim, code="agent_not_ready")
        return None
    if target.anyharness_workspace_id is None:
        await fail_claim(claim, code="runtime_not_ready")
        return None

    current = await mark_run_creating_session(
        run_id=claim.id,
        claim_id=claim.claim_id,
        anyharness_workspace_id=target.anyharness_workspace_id,
        now=utcnow(),
    )
    if current is None:
        return None
    if current.anyharness_session_id is not None:
        current = await apply_reasoning_effort_for_claim(current, target)
        if current is None:
            return None
        return CloudRunSessionContext(claim=current, target=target)

    try:
        session = await create_runtime_session(
            target.runtime_url,
            target.access_token,
            anyharness_workspace_id=target.anyharness_workspace_id,
            agent_kind=current.agent_kind or "",
            model_id=current.model_id,
            mode_id=current.mode_id,
        )
    except CloudRuntimeReconnectError:
        logger.exception("automation cloud executor session create failed run_id=%s", claim.id)
        await fail_claim(current, code="session_create_failed")
        return None

    attached = await attach_anyharness_session_to_run(
        run_id=current.id,
        claim_id=current.claim_id,
        anyharness_workspace_id=target.anyharness_workspace_id,
        anyharness_session_id=session.session_id,
        now=utcnow(),
    )
    if not attached:
        try:
            await close_runtime_session(
                target.runtime_url,
                target.access_token,
                session_id=session.session_id,
            )
        except CloudRuntimeReconnectError:
            logger.warning(
                "automation cloud executor could not close orphan session run_id=%s session_id=%s",
                claim.id,
                session.session_id,
                exc_info=True,
            )
        return None
    refreshed = await require_current_claim(current)
    if refreshed is None:
        return None
    refreshed = await apply_reasoning_effort_for_claim(refreshed, target)
    if refreshed is None:
        return None
    return CloudRunSessionContext(claim=refreshed, target=target)


async def apply_reasoning_effort_for_claim(
    claim: AutomationRunClaimValue,
    target: RuntimeConnectionTarget,
) -> AutomationRunClaimValue | None:
    if not claim.reasoning_effort or claim.anyharness_session_id is None:
        return claim
    try:
        await apply_runtime_reasoning_effort(
            target.runtime_url,
            target.access_token,
            session_id=claim.anyharness_session_id,
            reasoning_effort=claim.reasoning_effort,
        )
    except CloudRuntimeReconnectError:
        logger.exception(
            "automation cloud executor config apply failed run_id=%s session_id=%s",
            claim.id,
            claim.anyharness_session_id,
        )
        await fail_claim(claim, code="config_apply_failed")
        return None
    return await require_current_claim(claim)


async def send_prompt(context: CloudRunSessionContext) -> None:
    claim = context.claim
    target_workspace_id = context.target.anyharness_workspace_id
    if (
        claim.cloud_workspace_id is None
        or claim.anyharness_session_id is None
        or target_workspace_id is None
    ):
        await fail_claim(claim, code="stale_claim")
        return

    dispatching = await mark_run_dispatching(
        run_id=claim.id,
        claim_id=claim.claim_id,
        now=utcnow(),
    )
    if dispatching is None:
        return
    session_id = dispatching.anyharness_session_id
    assert session_id is not None
    try:
        await prompt_runtime_session(
            context.target.runtime_url,
            context.target.access_token,
            session_id=session_id,
            prompt=claim.prompt,
        )
    except CloudRuntimePromptDeliveryUncertainError:
        logger.exception(
            "automation cloud executor prompt delivery uncertain run_id=%s",
            claim.id,
        )
        await fail_claim(dispatching, code=AUTOMATION_ERROR_DISPATCH_UNCERTAIN)
        return
    except CloudRuntimeRequestRejectedError:
        logger.exception("automation cloud executor prompt rejected run_id=%s", claim.id)
        await fail_claim(dispatching, code="prompt_send_failed")
        return
    except CloudRuntimeReconnectError:
        logger.exception("automation cloud executor prompt send failed run_id=%s", claim.id)
        await fail_claim(dispatching, code="prompt_send_failed")
        return
    dispatched = await mark_run_dispatched(
        run_id=claim.id,
        claim_id=claim.claim_id,
        anyharness_workspace_id=target_workspace_id,
        anyharness_session_id=session_id,
        now=utcnow(),
    )
    if dispatched:
        logger.info("automation cloud executor dispatched run_id=%s", claim.id)
    else:
        logger.warning(
            "automation cloud executor could not mark prompt-accepted run dispatched run_id=%s",
            claim.id,
        )
