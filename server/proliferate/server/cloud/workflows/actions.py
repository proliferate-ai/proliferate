"""Step-actions ledger: claim, perform, and sweep server-side actions.

Invariant (L19): actions perform side effects of steps the runtime already
executed; they never decide or cause what executes next.

The ledger gives *exactly-once claim*. Action execution is *at-least-once
completion* via the sweeper, which retries stale 'pending' rows (an owner that
crashed before performing) and transient 'failed' rows (e.g. a Slack API
error), up to a max attempt count. A crash inside the action window (after the
Slack POST succeeded, before status='done' committed) can duplicate a send --
the same guarantee class as every non-transactional external side effect.
Slack keeps that honest weaker class.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from uuid import UUID, uuid4

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    WORKFLOW_STEP_NOTIFY,
)
from proliferate.db.models.cloud.workflows import WorkflowStepAction
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.cloud_workflows import WorkflowRunRecord
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.integrations.slack import client as slack_client
from proliferate.utils.crypto import decrypt_json
from proliferate.utils.time import utcnow

logger = logging.getLogger(__name__)

ACTION_STEP_KINDS: dict[str, str] = {
    "notify-with-channel-slack": "slack_notify",
}

_SWEEP_STALE_THRESHOLD = timedelta(seconds=60)
_MAX_ATTEMPTS = 5


async def claim_step_action(
    db: AsyncSession, *, run_id: UUID, step_key: str, action_kind: str
) -> UUID | None:
    """INSERT ... ON CONFLICT DO NOTHING. Returns the new action id when this
    caller won the claim, None when another observer already owns it."""
    action_id = uuid4()
    now = utcnow()
    stmt = (
        pg_insert(WorkflowStepAction)
        .values(
            id=action_id,
            run_id=run_id,
            step_key=step_key,
            action_kind=action_kind,
            status="pending",
            attempt_count=0,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(constraint="uq_workflow_step_action_claim")
        .returning(WorkflowStepAction.id)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


def _action_kind_for(step: dict[str, object], output: object) -> str | None:
    # notify is Slack-only in v2 (E1b) — no channel discriminator.
    if step.get("kind") == WORKFLOW_STEP_NOTIFY:
        return "slack_notify"
    return None


async def _organization_id_for_run(
    db: AsyncSession, *, run: WorkflowRunRecord
) -> UUID | None:
    """The run owner's current organization — the org whose integration policy
    governs this run's actions. In v1 the executor equals the workflow owner, so
    the owner's current membership is the run's org context. Returns None when
    the owner has no active membership (a bare personal user)."""
    membership = await organizations_store.get_current_membership_for_user(
        db, run.executor_user_id
    )
    return membership.organization.id if membership is not None else None


async def apply_step_actions(db: AsyncSession, *, run: WorkflowRunRecord) -> None:
    """Scan observed step outputs for action-bearing completed steps; claim and
    perform any not yet owned. Safe to call on every report/refresh: the ledger
    CAS makes re-observation free."""
    steps_by_key = _steps_by_key(run)
    for step_key, output in (run.step_outputs_json or {}).items():
        step = steps_by_key.get(step_key, {})
        action_kind = _action_kind_for(step, output)
        if action_kind is None:
            continue
        action_id = await claim_step_action(
            db, run_id=run.id, step_key=step_key, action_kind=action_kind
        )
        if action_id is None:
            continue
        await _perform(db, action_id, action_kind, run=run, step=step, output=output)


def _steps_by_key(run: WorkflowRunRecord) -> dict[str, dict[str, object]]:
    """Resolved-plan steps indexed by their structured ``key`` (B5). Step outputs
    are reported keyed by ``step_key``; this maps a key back to its plan step."""
    steps = (run.resolved_plan_json or {}).get("steps", [])
    return {step["key"]: step for step in steps if isinstance(step, dict) and "key" in step}


async def _perform(
    db: AsyncSession,
    action_id: UUID,
    action_kind: str,
    *,
    run: WorkflowRunRecord,
    step: dict[str, object],
    output: object,
) -> None:
    try:
        if action_kind == "slack_notify":
            organization_id = await _organization_id_for_run(db, run=run)
            await _perform_slack_notify(
                db, action_id, run=run, step=step, output=output, organization_id=organization_id
            )
        else:
            await _mark_action_failed(
                db, action_id, error_message=f"Unknown action kind: {action_kind}"
            )
    except Exception:
        logger.exception("action perform failed action_id=%s kind=%s", action_id, action_kind)
        await _mark_action_failed(db, action_id, error_message="Unexpected error during perform")


async def _perform_slack_notify(
    db: AsyncSession,
    action_id: UUID,
    *,
    run: WorkflowRunRecord,
    step: dict[str, object],
    output: object,
    organization_id: UUID | None,
) -> None:
    slack_channel_id = step.get("slack_channel_id")
    if not slack_channel_id or not isinstance(slack_channel_id, str):
        await _mark_action_failed(db, action_id, error_message="Missing slack_channel_id on step")
        return

    message = output.get("message") if isinstance(output, dict) else None
    if not message or not isinstance(message, str):
        await _mark_action_failed(db, action_id, error_message="No message in step output")
        return

    # Pass the run's org context so org integration policy is honored: a Slack
    # account the owner holds personally is still blocked if their org disabled
    # the Slack integration.
    account_pair = await accounts_store.get_ready_account_for_provider(
        db, run.executor_user_id, "slack", organization_id=organization_id
    )
    if account_pair is None:
        await _mark_action_failed(db, action_id, error_message="No ready Slack account")
        return

    account, _definition = account_pair
    try:
        bundle = decrypt_json(account.credential_ciphertext)
    except Exception:
        await _mark_action_failed(db, action_id, error_message="Failed to decrypt Slack credentials")
        return

    bot_token = bundle.get("bot_token") or bundle.get("access_token")
    if not bot_token:
        await _mark_action_failed(db, action_id, error_message="No bot_token in credential bundle")
        return

    try:
        result = await slack_client.chat_post_message(
            bot_token=bot_token,
            channel_id=slack_channel_id,
            text=message,
            blocks=[],
            thread_ts=None,
        )
    except Exception as exc:
        await _mark_action_failed(db, action_id, error_message=str(exc)[:480])
        return

    await _mark_action_done(
        db, action_id, result_json={"channel_id": result.channel_id, "message_ts": result.message_ts}
    )


async def _mark_action_done(
    db: AsyncSession, action_id: UUID, *, result_json: dict[str, object]
) -> None:
    action = await db.get(WorkflowStepAction, action_id)
    if action is None:
        return
    action.status = "done"
    action.result_json = result_json
    action.attempt_count += 1
    action.updated_at = utcnow()
    await db.flush()


async def _mark_action_failed(
    db: AsyncSession, action_id: UUID, *, error_message: str
) -> None:
    action = await db.get(WorkflowStepAction, action_id)
    if action is None:
        return
    action.status = "failed"
    action.error_message = error_message
    action.attempt_count += 1
    action.updated_at = utcnow()
    await db.flush()


async def sweep_pending_actions(db: AsyncSession) -> int:
    """Retry stale 'pending' rows (an owner that crashed before performing) and
    transient 'failed' rows, both older than the stale threshold and below the
    max attempt count. Rows that exhaust their attempts simply rest at
    'failed' with their real error_message -- the store scan excludes them
    from future sweeps.

    Returns the number of actions retried.
    """
    stale_before = utcnow() - _SWEEP_STALE_THRESHOLD
    actions = await store.list_retryable_actions(
        db, before=stale_before, max_attempts=_MAX_ATTEMPTS, limit=50
    )
    retried = 0
    for action_row in actions:
        run = await store.get_run(db, action_row.run_id)
        if run is None:
            await _mark_action_failed(db, action_row.id, error_message="Run not found")
            retried += 1
            continue
        step = _steps_by_key(run).get(action_row.step_key, {})
        output_raw = (run.step_outputs_json or {}).get(action_row.step_key, {})
        await _perform(
            db, action_row.id, action_row.action_kind, run=run, step=step, output=output_raw
        )
        retried += 1
    return retried
