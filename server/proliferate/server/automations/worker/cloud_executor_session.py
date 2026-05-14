"""Session and prompt stages for cloud automation execution."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import cast

from proliferate.constants.cloud import CloudCommandKind
from proliferate.db.store.automation_run_claim_transitions import (
    attach_anyharness_session_to_run,
    mark_run_creating_session,
    mark_run_dispatched,
    mark_run_dispatching,
)
from proliferate.db.store.automation_run_claim_values import (
    AutomationRunClaimValue,
)
from proliferate.db.store.automation_run_claims import (
    ClaimTransitionRule as StoreClaimTransitionRule,
)
from proliferate.server.automations.domain.claim_lifecycle import (
    ANYHARNESS_SESSION_ATTACHMENT_TRANSITION,
    AUTOMATION_ERROR_DISPATCH_UNCERTAIN,
    CREATING_SESSION_TRANSITION,
    DISPATCHED_TRANSITION,
    DISPATCHING_TRANSITION,
    claim_is_active,
)
from proliferate.server.automations.worker.cloud_executor_claims import (
    fail_claim,
    require_current_claim,
)
from proliferate.server.automations.worker.cloud_executor_commands import (
    enqueue_automation_command,
    wait_for_command_result,
)
from proliferate.server.automations.worker.cloud_executor_target import (
    CloudRunTargetContext,
    resolve_target_for_claim,
)
from proliferate.utils.time import utcnow

logger = logging.getLogger("proliferate.server.automations.worker.cloud_executor")

COMMAND_WAIT_TIMEOUT_SECONDS = 240.0


@dataclass(frozen=True)
class CloudRunSessionContext:
    claim: AutomationRunClaimValue
    target: CloudRunTargetContext


def _store_transition(rule: object) -> StoreClaimTransitionRule:
    return cast(StoreClaimTransitionRule, rule)


def _claim_command_timeout(claim: AutomationRunClaimValue) -> timedelta:
    remaining = (claim.claim_expires_at - utcnow()).total_seconds()
    return timedelta(seconds=max(1.0, min(COMMAND_WAIT_TIMEOUT_SECONDS, remaining)))


def _session_id_from_body(body: dict[str, object]) -> str | None:
    session_id = body.get("id")
    if isinstance(session_id, str) and session_id.strip():
        return session_id
    session = body.get("session")
    if isinstance(session, dict):
        nested = session.get("id")
        if isinstance(nested, str) and nested.strip():
            return nested
    return None


def _start_session_payload(
    claim: AutomationRunClaimValue,
    *,
    anyharness_workspace_id: str,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "workspaceId": anyharness_workspace_id,
        "agentKind": claim.agent_kind or "",
        "origin": {"kind": "system", "entrypoint": "cloud"},
    }
    if claim.model_id:
        payload["modelId"] = claim.model_id
    if claim.mode_id:
        payload["modeId"] = claim.mode_id
    return payload


async def create_or_load_session(
    claim: AutomationRunClaimValue,
) -> CloudRunSessionContext | None:
    target = await resolve_target_for_claim(claim)
    if target is None:
        return None

    current = await mark_run_creating_session(
        run_id=claim.id,
        claim_id=claim.claim_id,
        anyharness_workspace_id=target.anyharness_workspace_id,
        now=utcnow(),
        transition=_store_transition(CREATING_SESSION_TRANSITION),
        claim_is_active=claim_is_active,
    )
    if current is None:
        return None
    if current.anyharness_session_id is not None:
        current = await apply_reasoning_effort_for_claim(current, target)
        if current is None:
            return None
        return CloudRunSessionContext(claim=current, target=target)

    try:
        command = await enqueue_automation_command(
            current,
            target_id=target.target_id,
            stage="start-session",
            kind=CloudCommandKind.start_session.value,
            workspace_id=target.anyharness_workspace_id,
            payload=_start_session_payload(
                current,
                anyharness_workspace_id=target.anyharness_workspace_id,
            ),
        )
        result = await wait_for_command_result(command, timeout=_claim_command_timeout(current))
    except TimeoutError:
        logger.exception("automation cloud executor session command timed out run_id=%s", claim.id)
        await fail_claim(current, code="session_create_failed")
        return None
    except Exception:
        logger.exception("automation cloud executor session create failed run_id=%s", claim.id)
        await fail_claim(current, code="session_create_failed")
        return None
    session_id = _session_id_from_body(result.body)
    if session_id is None:
        logger.error(
            "automation cloud executor session command returned no session id "
            "run_id=%s command_id=%s",
            claim.id,
            result.command.id,
        )
        await fail_claim(current, code="session_create_failed")
        return None

    attached = await attach_anyharness_session_to_run(
        run_id=current.id,
        claim_id=current.claim_id,
        anyharness_workspace_id=target.anyharness_workspace_id,
        anyharness_session_id=session_id,
        now=utcnow(),
        transition=_store_transition(ANYHARNESS_SESSION_ATTACHMENT_TRANSITION),
        claim_is_active=claim_is_active,
    )
    if not attached:
        logger.warning(
            "automation cloud executor created session after losing claim run_id=%s session_id=%s",
            claim.id,
            session_id,
        )
        try:
            await enqueue_automation_command(
                current,
                target_id=target.target_id,
                stage=f"close-orphan-session:{session_id}",
                kind=CloudCommandKind.close_session.value,
                workspace_id=target.anyharness_workspace_id,
                session_id=session_id,
                payload={},
            )
        except Exception:
            logger.warning(
                "automation cloud executor could not enqueue orphan session close "
                "run_id=%s session_id=%s",
                claim.id,
                session_id,
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
    target: CloudRunTargetContext,
) -> AutomationRunClaimValue | None:
    if not claim.reasoning_effort or claim.anyharness_session_id is None:
        return claim
    try:
        command = await enqueue_automation_command(
            claim,
            target_id=target.target_id,
            stage="update-reasoning-effort",
            kind=CloudCommandKind.update_session_config.value,
            workspace_id=target.anyharness_workspace_id,
            session_id=claim.anyharness_session_id,
            payload={
                "normalizedControl": "effort",
                "value": claim.reasoning_effort,
            },
        )
        await wait_for_command_result(command, timeout=_claim_command_timeout(claim))
    except Exception:
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
        transition=_store_transition(DISPATCHING_TRANSITION),
        claim_is_active=claim_is_active,
    )
    if dispatching is None:
        return
    session_id = dispatching.anyharness_session_id
    assert session_id is not None
    try:
        command = await enqueue_automation_command(
            dispatching,
            target_id=context.target.target_id,
            stage="send-prompt",
            kind=CloudCommandKind.send_prompt.value,
            workspace_id=target_workspace_id,
            session_id=session_id,
            payload={
                "blocks": [{"type": "text", "text": claim.prompt}],
            },
        )
        await wait_for_command_result(command, timeout=_claim_command_timeout(dispatching))
    except TimeoutError:
        logger.exception(
            "automation cloud executor prompt command timed out run_id=%s",
            claim.id,
        )
        await fail_claim(dispatching, code=AUTOMATION_ERROR_DISPATCH_UNCERTAIN)
        return
    except Exception:
        logger.exception("automation cloud executor prompt send failed run_id=%s", claim.id)
        await fail_claim(dispatching, code="prompt_send_failed")
        return
    dispatched = await mark_run_dispatched(
        run_id=claim.id,
        claim_id=claim.claim_id,
        anyharness_workspace_id=target_workspace_id,
        anyharness_session_id=session_id,
        now=utcnow(),
        transition=_store_transition(DISPATCHED_TRANSITION),
        claim_is_active=claim_is_active,
    )
    if dispatched:
        logger.info("automation cloud executor dispatched run_id=%s", claim.id)
    else:
        logger.warning(
            "automation cloud executor could not mark prompt-accepted run dispatched run_id=%s",
            claim.id,
        )
