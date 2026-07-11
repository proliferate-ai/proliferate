"""Workflow step-action sweeper retry and attempt-bound tests."""

from __future__ import annotations

import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workflows import WorkflowStepAction
from proliferate.db.store.integrations.accounts import ReadyAccountRow
from proliferate.server.cloud.workflows.actions import _MAX_ATTEMPTS, sweep_pending_actions
from proliferate.utils.time import utcnow
from tests.unit.workflow_action_test_support import _make_sweep_run

pytestmark = pytest.mark.asyncio


async def test_sweeper_retries_stale_pending_and_respects_bound(
    db_session: AsyncSession,
) -> None:
    run_id = await _make_sweep_run(db_session, name="test-sweep-pending")

    stale_time = utcnow() - timedelta(seconds=120)
    action = WorkflowStepAction(
        id=uuid.uuid4(),
        run_id=run_id,
        step_key="0.-.0",
        action_kind="slack_notify",
        status="pending",
        attempt_count=_MAX_ATTEMPTS,
        created_at=stale_time,
        updated_at=stale_time,
    )
    db_session.add(action)
    await db_session.flush()

    # A row already at the attempt cap is not selected by the sweep at all.
    retried = await sweep_pending_actions(db_session)
    assert retried == 0

    await db_session.refresh(action)
    assert action.status == "pending"
    assert action.attempt_count == _MAX_ATTEMPTS


async def test_sweeper_retries_transient_failed_below_cap(
    db_session: AsyncSession,
) -> None:
    """A 'failed' row below the attempt cap gets retried by the sweep, and a
    successful retry lands 'done' without clobbering the prior error_message
    logic (it's overwritten by the real result on success)."""
    run_id = await _make_sweep_run(db_session, name="test-sweep-failed")

    stale_time = utcnow() - timedelta(seconds=120)
    action = WorkflowStepAction(
        id=uuid.uuid4(),
        run_id=run_id,
        step_key="0.-.0",
        action_kind="slack_notify",
        status="failed",
        attempt_count=1,
        error_message="Transient Slack API error",
        created_at=stale_time,
        updated_at=stale_time,
    )
    db_session.add(action)
    await db_session.flush()

    from proliferate.integrations.slack.client import SlackPostMessageResult

    mock_result = SlackPostMessageResult(channel_id="C1", message_ts="1111.2222")

    with (
        patch(
            "proliferate.server.cloud.workflows.actions.accounts_store.get_ready_account_for_provider",
            new_callable=AsyncMock,
            return_value=ReadyAccountRow(
                account=type("FakeAccount", (), {"credential_ciphertext": "encrypted"})(),
                definition=type("FakeDef", (), {})(),
                org_policy_enabled=None,
            ),
        ),
        patch(
            "proliferate.server.cloud.workflows.actions.decrypt_json",
            return_value={"bot_token": "xoxb-test"},
        ),
        patch(
            "proliferate.server.cloud.workflows.actions.slack_client.chat_post_message",
            new_callable=AsyncMock,
            return_value=mock_result,
        ),
    ):
        retried = await sweep_pending_actions(db_session)

    assert retried == 1

    await db_session.refresh(action)
    assert action.status == "done"
    assert action.attempt_count == 2


async def test_sweeper_does_not_select_action_at_attempt_cap(
    db_session: AsyncSession,
) -> None:
    """A row at attempt_count == _MAX_ATTEMPTS is not selected by the sweep,
    regardless of status, and its error_message is left untouched."""
    run_id = await _make_sweep_run(db_session, name="test-sweep-cap")

    stale_time = utcnow() - timedelta(seconds=120)
    action = WorkflowStepAction(
        id=uuid.uuid4(),
        run_id=run_id,
        step_key="0.-.0",
        action_kind="slack_notify",
        status="failed",
        attempt_count=_MAX_ATTEMPTS,
        error_message="Original transient error",
        created_at=stale_time,
        updated_at=stale_time,
    )
    db_session.add(action)
    await db_session.flush()

    retried = await sweep_pending_actions(db_session)
    assert retried == 0

    await db_session.refresh(action)
    assert action.status == "failed"
    assert action.error_message == "Original transient error"
