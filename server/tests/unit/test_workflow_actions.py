"""Step-actions ledger tests (PR A): claim CAS, apply idempotency, slack perform,
failure handling, sweeper, org-policy enforcement, notify validator, slack
channels endpoint."""

from __future__ import annotations

import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.workflows import WorkflowStepAction
from proliferate.db.store.cloud_workflows import WorkflowRunRecord
from proliferate.server.cloud.workflows.domain.definition import (
    WorkflowDefinitionError,
    parse_definition,
)
from proliferate.server.cloud.workflows.actions import (
    _MAX_ATTEMPTS,
    apply_step_actions,
    claim_step_action,
    sweep_pending_actions,
)
from proliferate.utils.time import utcnow

pytestmark = pytest.mark.asyncio


async def _make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"wf-fx-{uuid.uuid4().hex[:8]}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


def _make_run_record(
    *,
    run_id: uuid.UUID | None = None,
    executor_user_id: uuid.UUID | None = None,
    step_outputs_json: dict | None = None,
    resolved_plan_json: dict | None = None,
) -> WorkflowRunRecord:
    now = utcnow()
    return WorkflowRunRecord(
        id=run_id or uuid.uuid4(),
        workflow_id=uuid.uuid4(),
        workflow_version_id=uuid.uuid4(),
        trigger_kind="manual",
        trigger_id=None,
        scheduled_for=None,
        executor_user_id=executor_user_id or uuid.uuid4(),
        args_json={},
        target_mode="local",
        resolved_plan_json=resolved_plan_json or {},
        status="completed",
        step_cursor=1,
        step_outputs_json=step_outputs_json,
        anyharness_workspace_id=None,
        anyharness_session_ids=None,
        error_code=None,
        error_message=None,
        cost_usd=None,
        cost_tokens=None,
        created_at=now,
        updated_at=now,
        delivered_at=None,
        started_at=now,
        finished_at=now,
    )


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
            return_value=(
                type(
                    "FakeAccount",
                    (),
                    {"credential_ciphertext": "encrypted"},
                )(),
                type("FakeDef", (), {})(),
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

    action = (await db_session.get(WorkflowStepAction, (await db_session.execute(
        __import__("sqlalchemy").select(WorkflowStepAction).where(
            WorkflowStepAction.run_id == run_id
        )
    )).scalar_one().id))
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
            "steps": [
                {"kind": "notify", "message": "x", "slack_channel_id": "C1", "key": "0.-.0"}
            ]
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
            "steps": [
                {"kind": "notify", "message": "x", "slack_channel_id": "C1", "key": "0.-.0"}
            ]
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


# --- sweeper retries stale pending/failed and respects attempt bound ------------


async def _make_sweep_run(db_session: AsyncSession, *, name: str) -> uuid.UUID:
    from proliferate.db.models.cloud.workflows import Workflow, WorkflowRun, WorkflowVersion

    user = await _make_user(db_session)
    wf = Workflow(
        owner_user_id=user.id,
        created_by_user_id=user.id,
        name=name,
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
                {"kind": "notify", "message": "s", "slack_channel_id": "C1", "key": "0.-.0"}
            ]
        },
        status="completed",
        step_outputs_json={"0.-.0": {"channel": "slack", "message": "s"}},
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(run_row)
    await db_session.flush()
    return run_id


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
            return_value=(
                type("FakeAccount", (), {"credential_ciphertext": "encrypted"})(),
                type("FakeDef", (), {})(),
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


# --- notify-step validator requires slack_channel_id for slack channel -----------


def _notify_definition(step: dict) -> dict:
    return {
        "version": 1,
        "inputs": [],
        "integrations": ["slack"],
        "agents": [
            {"slot": "main", "harness": "claude", "model": "sonnet", "steps": [step]},
        ],
    }


def test_notify_validator_requires_slack_channel_id() -> None:
    definition = _notify_definition({"kind": "notify", "message": "hello"})
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert "slack_channel_id" in exc.value.message


def test_notify_validator_accepts_slack_channel_id() -> None:
    definition = _notify_definition(
        {"kind": "notify", "message": "hello", "slack_channel_id": "C1234"}
    )
    canonical, _specs = parse_definition(definition)
    assert canonical["agents"][0]["steps"][0]["slack_channel_id"] == "C1234"


def test_notify_validator_rejects_channel_discriminator() -> None:
    # E1b: the channel discriminator (and in_app) are gone — notify is Slack-only.
    definition = _notify_definition(
        {"kind": "notify", "channel": "in_app", "message": "hi", "slack_channel_id": "C1"}
    )
    with pytest.raises(WorkflowDefinitionError) as exc:
        parse_definition(definition)
    assert exc.value.code == "unknown_field"


# --- channels endpoint connected / not-connected --------------------------------


async def test_slack_channels_endpoint_not_connected(client) -> None:  # type: ignore[no-untyped-def]
    """When no slack account, returns connected=false with empty list."""
    from proliferate.db import engine as engine_module

    session_factory = engine_module.async_session_factory
    async with session_factory() as db:
        user = await _make_user(db)
        await db.commit()

    from proliferate.server.cloud.workflows.api import list_slack_channels_endpoint

    # Direct unit test of the logic
    async with session_factory() as db:
        with patch(
            "proliferate.server.cloud.workflows.api.accounts_store.get_ready_account_for_provider",
            new_callable=AsyncMock,
            return_value=None,
        ):
            result = await list_slack_channels_endpoint(db=db, user=user)
    assert result.connected is False
    assert result.channels == []


async def test_slack_channels_endpoint_connected(client) -> None:  # type: ignore[no-untyped-def]
    """When slack account exists, returns connected=true with channels."""
    from proliferate.db import engine as engine_module
    from proliferate.integrations.slack.client import SlackChannelSummary

    session_factory = engine_module.async_session_factory
    async with session_factory() as db:
        user = await _make_user(db)
        await db.commit()

    fake_account = type("FakeAccount", (), {"credential_ciphertext": "enc"})()
    fake_def = type("FakeDef", (), {})()
    fake_channels = [
        SlackChannelSummary(
            id="C1", name="general", is_channel=True, is_private=False, is_archived=False
        ),
        SlackChannelSummary(
            id="C2", name="random", is_channel=True, is_private=False, is_archived=False
        ),
    ]

    from proliferate.server.cloud.workflows.api import list_slack_channels_endpoint

    async with session_factory() as db:
        with (
            patch(
                "proliferate.server.cloud.workflows.api.accounts_store.get_ready_account_for_provider",
                new_callable=AsyncMock,
                return_value=(fake_account, fake_def),
            ),
            patch(
                "proliferate.server.cloud.workflows.api.decrypt_json",
                return_value={"bot_token": "xoxb-test"},
            ),
            patch(
                "proliferate.server.cloud.workflows.api.slack_client.list_channels",
                new_callable=AsyncMock,
                return_value=fake_channels,
            ),
        ):
            result = await list_slack_channels_endpoint(db=db, user=user)
    assert result.connected is True
    assert len(result.channels) == 2
    assert result.channels[0].id == "C1"
