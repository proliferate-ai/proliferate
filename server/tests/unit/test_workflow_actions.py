"""Workflow step-action claim, apply, Slack delivery, and policy tests."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.cloud.workflows import WorkflowStepAction
from proliferate.db.store.integrations.accounts import ReadyAccountRow
from proliferate.server.cloud.workflows.actions import apply_step_actions, claim_step_action
from proliferate.utils.time import utcnow
from tests.unit.workflow_action_test_support import _make_run_record, _make_user

pytestmark = pytest.mark.asyncio

# --- claim CAS wins-once --------------------------------------------------------


async def test_claim_cas_wins_once(db_session: AsyncSession) -> None:
    """Two claims for the same (run, step, kind): only the first succeeds."""
    from proliferate.db.models.cloud.workflows import Workflow, WorkflowRun, WorkflowVersion

    user = await _make_user(db_session)
    wf = Workflow(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name="test",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(wf)
    await db_session.flush()
    ver = WorkflowVersion(
        workflow_id=wf.id,
        version_n=1,
        definition_json={"version": 1, "inputs": [], "integrations": [], "agents": []},
        created_by_user_id=user.id,
        created_at=utcnow(),
    )
    db_session.add(ver)
    await db_session.flush()
    run = WorkflowRun(
        id=uuid.uuid4(),
        workflow_id=wf.id,
        workflow_version_id=ver.id,
        trigger_kind="manual",
        executor_user_id=user.id,
        args_json={},
        target_mode="local",
        resolved_plan_json={},
        status="completed",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(run)
    await db_session.flush()

    first = await claim_step_action(
        db_session, run_id=run.id, step_key="0.-.0", action_kind="slack_notify"
    )
    assert first is not None

    second = await claim_step_action(
        db_session, run_id=run.id, step_key="0.-.0", action_kind="slack_notify"
    )
    assert second is None


# --- apply_step_actions idempotent on re-report ----------------------------------


async def test_apply_step_actions_idempotent(db_session: AsyncSession) -> None:
    """Calling apply_step_actions twice on the same run does not claim twice."""
    from proliferate.db.models.cloud.workflows import Workflow, WorkflowRun, WorkflowVersion

    user = await _make_user(db_session)
    wf = Workflow(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name="test-idem",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(wf)
    await db_session.flush()
    ver = WorkflowVersion(
        workflow_id=wf.id,
        version_n=1,
        definition_json={},
        created_by_user_id=user.id,
        created_at=utcnow(),
    )
    db_session.add(ver)
    await db_session.flush()
    run_id = uuid.uuid4()
    run_row = WorkflowRun(
        id=run_id,
        workflow_id=wf.id,
        workflow_version_id=ver.id,
        trigger_kind="manual",
        executor_user_id=user.id,
        args_json={},
        target_mode="local",
        resolved_plan_json={
            "steps": [
                {"kind": "notify", "message": "hello", "slack_channel_id": "C1", "key": "0.-.0"}
            ]
        },
        status="completed",
        step_outputs_json={"0.-.0": {"channel": "slack", "message": "hello"}},
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(run_row)
    await db_session.flush()

    run_record = _make_run_record(
        run_id=run_id,
        executor_user_id=user.id,
        resolved_plan_json={
            "steps": [
                {"kind": "notify", "message": "hello", "slack_channel_id": "C1", "key": "0.-.0"}
            ]
        },
        step_outputs_json={"0.-.0": {"channel": "slack", "message": "hello"}},
    )

    with patch(
        "proliferate.server.cloud.workflows.actions._perform_slack_notify",
        new_callable=AsyncMock,
    ) as mock_perform:
        await apply_step_actions(db_session, run=run_record)
        assert mock_perform.call_count == 1

        await apply_step_actions(db_session, run=run_record)
        assert mock_perform.call_count == 1


# --- slack perform success path -------------------------------------------------


async def test_perform_slack_notify_success(db_session: AsyncSession) -> None:
    from proliferate.db.models.cloud.workflows import Workflow, WorkflowRun, WorkflowVersion
    from proliferate.integrations.slack.client import SlackPostMessageResult

    user = await _make_user(db_session)
    wf = Workflow(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name="test-slack",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(wf)
    await db_session.flush()
    ver = WorkflowVersion(
        workflow_id=wf.id,
        version_n=1,
        definition_json={},
        created_by_user_id=user.id,
        created_at=utcnow(),
    )
    db_session.add(ver)
    await db_session.flush()
    run_id = uuid.uuid4()
    run_row = WorkflowRun(
        id=run_id,
        workflow_id=wf.id,
        workflow_version_id=ver.id,
        trigger_kind="manual",
        executor_user_id=user.id,
        args_json={},
        target_mode="local",
        resolved_plan_json={
            "steps": [
                {"kind": "notify", "message": "hi", "slack_channel_id": "C123", "key": "0.-.0"}
            ]
        },
        status="completed",
        step_outputs_json={"0.-.0": {"channel": "slack", "message": "workflow done"}},
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(run_row)
    await db_session.flush()

    run_record = _make_run_record(
        run_id=run_id,
        executor_user_id=user.id,
        resolved_plan_json={
            "steps": [
                {"kind": "notify", "message": "hi", "slack_channel_id": "C123", "key": "0.-.0"}
            ]
        },
        step_outputs_json={"0.-.0": {"channel": "slack", "message": "workflow done"}},
    )

    mock_result = SlackPostMessageResult(channel_id="C123", message_ts="1234.5678")

    with (
        patch(
            "proliferate.server.cloud.workflows.actions.accounts_store.get_ready_account_for_provider",
            new_callable=AsyncMock,
            return_value=ReadyAccountRow(
                account=type(
                    "FakeAccount",
                    (),
                    {"credential_ciphertext": "encrypted"},
                )(),
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
        ) as mock_chat,
    ):
        await apply_step_actions(db_session, run=run_record)

    mock_chat.assert_called_once_with(
        bot_token="xoxb-test",
        channel_id="C123",
        text="workflow done",
        blocks=[],
        thread_ts=None,
    )

    action = await db_session.get(
        WorkflowStepAction,
        (
            await db_session.execute(
                __import__("sqlalchemy")
                .select(WorkflowStepAction)
                .where(WorkflowStepAction.run_id == run_id)
            )
        )
        .scalar_one()
        .id,
    )
    assert action.status == "done"
    assert action.result_json == {"channel_id": "C123", "message_ts": "1234.5678"}


# --- perform failure records 'failed' -------------------------------------------


async def test_perform_failure_records_failed(db_session: AsyncSession) -> None:
    from proliferate.db.models.cloud.workflows import Workflow, WorkflowRun, WorkflowVersion

    user = await _make_user(db_session)
    wf = Workflow(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name="test-fail",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(wf)
    await db_session.flush()
    ver = WorkflowVersion(
        workflow_id=wf.id,
        version_n=1,
        definition_json={},
        created_by_user_id=user.id,
        created_at=utcnow(),
    )
    db_session.add(ver)
    await db_session.flush()
    run_id = uuid.uuid4()
    run_row = WorkflowRun(
        id=run_id,
        workflow_id=wf.id,
        workflow_version_id=ver.id,
        trigger_kind="manual",
        executor_user_id=user.id,
        args_json={},
        target_mode="local",
        resolved_plan_json={
            "steps": [{"kind": "notify", "message": "x", "slack_channel_id": "C1", "key": "0.-.0"}]
        },
        status="completed",
        step_outputs_json={"0.-.0": {"channel": "slack", "message": "x"}},
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(run_row)
    await db_session.flush()

    run_record = _make_run_record(
        run_id=run_id,
        executor_user_id=user.id,
        resolved_plan_json={
            "steps": [{"kind": "notify", "message": "x", "slack_channel_id": "C1", "key": "0.-.0"}]
        },
        step_outputs_json={"0.-.0": {"channel": "slack", "message": "x"}},
    )

    with patch(
        "proliferate.server.cloud.workflows.actions.accounts_store.get_ready_account_for_provider",
        new_callable=AsyncMock,
        return_value=None,
    ):
        await apply_step_actions(db_session, run=run_record)

    from sqlalchemy import select

    action = (
        await db_session.execute(
            select(WorkflowStepAction).where(WorkflowStepAction.run_id == run_id)
        )
    ).scalar_one()
    assert action.status == "failed"
    assert "No ready Slack account" in (action.error_message or "")


# --- org policy blocks a personally-connected account ---------------------------


async def test_org_policy_disabled_blocks_slack_notify(db_session: AsyncSession) -> None:
    """Owner personally holds a ready Slack account, but their org has disabled the
    Slack integration by policy => the notify action is blocked (no send).

    The guarantee lives in the DB: ``get_ready_account_for_provider`` is called
    with the run's real org id and its policy join excludes the account. Only the
    Slack network client is mocked (it must never be reached)."""
    from proliferate.db.models.cloud.integrations import (
        CloudIntegrationAccount,
        CloudIntegrationDefinition,
        CloudIntegrationPolicy,
    )
    from proliferate.db.models.cloud.workflows import Workflow, WorkflowRun, WorkflowVersion
    from proliferate.db.models.organizations import Organization, OrganizationMembership

    user = await _make_user(db_session)

    # The owner's org, with the owner as an active member (this is how the run's
    # org context is resolved — v1 executor == workflow owner).
    org = Organization(
        id=uuid.uuid4(),
        name="Acme",
        status=ORGANIZATION_STATUS_ACTIVE,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(org)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=org.id,
            user_id=user.id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=utcnow(),
            created_at=utcnow(),
            updated_at=utcnow(),
        )
    )

    # Seed Slack definition, enabled by default, but the org policy disables it.
    definition = CloudIntegrationDefinition(
        id=uuid.uuid4(),
        source="seed",
        namespace="slack",
        display_name="Slack",
        organization_id=None,
        auth_kind="oauth2",
        enabled_by_default=True,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(definition)
    await db_session.flush()
    db_session.add(
        CloudIntegrationPolicy(
            organization_id=org.id,
            definition_id=definition.id,
            enabled=False,
            updated_by_user_id=user.id,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
    )
    # Owner personally has a ready Slack account for that same definition.
    db_session.add(
        CloudIntegrationAccount(
            id=uuid.uuid4(),
            definition_id=definition.id,
            owner_user_id=user.id,
            owner_scope="personal",
            enabled=True,
            status="ready",
            auth_kind="oauth2",
            credential_ciphertext="encrypted",
            created_at=utcnow(),
            updated_at=utcnow(),
        )
    )
    await db_session.flush()

    wf = Workflow(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name="test-policy",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(wf)
    await db_session.flush()
    ver = WorkflowVersion(
        workflow_id=wf.id,
        version_n=1,
        definition_json={},
        created_by_user_id=user.id,
        created_at=utcnow(),
    )
    db_session.add(ver)
    await db_session.flush()
    run_id = uuid.uuid4()
    run_row = WorkflowRun(
        id=run_id,
        workflow_id=wf.id,
        workflow_version_id=ver.id,
        trigger_kind="manual",
        executor_user_id=user.id,
        args_json={},
        target_mode="local",
        resolved_plan_json={
            "steps": [
                {"kind": "notify", "message": "hi", "slack_channel_id": "C1", "key": "0.-.0"}
            ]
        },
        status="completed",
        step_outputs_json={"0.-.0": {"channel": "slack", "message": "hi"}},
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(run_row)
    await db_session.flush()

    run_record = _make_run_record(
        run_id=run_id,
        executor_user_id=user.id,
        resolved_plan_json={
            "steps": [
                {"kind": "notify", "message": "hi", "slack_channel_id": "C1", "key": "0.-.0"}
            ]
        },
        step_outputs_json={"0.-.0": {"channel": "slack", "message": "hi"}},
    )

    with patch(
        "proliferate.server.cloud.workflows.actions.slack_client.chat_post_message",
        new_callable=AsyncMock,
    ) as mock_chat:
        await apply_step_actions(db_session, run=run_record)

    mock_chat.assert_not_called()

    from sqlalchemy import select

    action = (
        await db_session.execute(
            select(WorkflowStepAction).where(WorkflowStepAction.run_id == run_id)
        )
    ).scalar_one()
    assert action.status == "failed"
    assert "No ready Slack account" in (action.error_message or "")
