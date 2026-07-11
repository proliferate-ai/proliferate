"""WF-ID never discovers, claims, decrypts, or sends legacy step actions."""

from __future__ import annotations

import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workflow_actions import WorkflowStepAction
from proliferate.server.cloud.workflows.actions import (
    apply_step_actions,
    claim_step_action,
    sweep_pending_actions,
)
from proliferate.utils.time import utcnow
from tests.unit.workflow_action_test_support import _make_run_record, _make_sweep_run

pytestmark = pytest.mark.asyncio


async def test_stale_slack_action_is_not_discovered_or_sent(
    db_session: AsyncSession,
) -> None:
    run_id = await _make_sweep_run(db_session, name="wf-id-action-canary")
    stale = utcnow() - timedelta(minutes=10)
    action = WorkflowStepAction(
        id=uuid.uuid4(),
        run_id=run_id,
        step_key="0.-.0",
        action_kind="slack_notify",
        status="pending",
        attempt_count=0,
        created_at=stale,
        updated_at=stale,
    )
    db_session.add(action)
    await db_session.flush()

    with (
        patch(
            "proliferate.server.cloud.workflows.actions.accounts_store."
            "get_ready_account_for_provider",
            new_callable=AsyncMock,
        ) as account_lookup,
        patch("proliferate.server.cloud.workflows.actions.decrypt_json") as decrypt,
        patch(
            "proliferate.server.cloud.workflows.actions.slack_client.chat_post_message",
            new_callable=AsyncMock,
        ) as slack_send,
    ):
        assert await sweep_pending_actions(db_session) == 0

    account_lookup.assert_not_awaited()
    decrypt.assert_not_called()
    slack_send.assert_not_awaited()
    await db_session.refresh(action)
    assert action.status == "pending"
    assert action.attempt_count == 0


async def test_action_claim_and_apply_are_hard_disabled(
    db_session: AsyncSession,
) -> None:
    run = _make_run_record(
        step_outputs_json={"0.-.0": {"message": "WF_ACTION_CANARY"}},
        resolved_plan_json={
            "steps": [
                {
                    "key": "0.-.0",
                    "kind": "notify",
                    "slack_channel_id": "C-CANARY",
                }
            ]
        },
    )
    assert (
        await claim_step_action(
            db_session,
            run_id=run.id,
            step_key="0.-.0",
            action_kind="slack_notify",
        )
        is None
    )
    await apply_step_actions(db_session, run=run)
    assert await db_session.scalar(
        select(func.count()).select_from(WorkflowStepAction)
    ) == 0
