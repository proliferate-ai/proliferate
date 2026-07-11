"""WF-ID keeps all unattended trigger activation side-effect free."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.db.models.cloud.workflow_actions import WorkflowStepAction
from proliferate.db.models.cloud.workflows import (
    WorkflowRun,
    WorkflowTrigger,
    WorkflowTriggerItem,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import poller, scheduler, triggers
from proliferate.utils.time import utcnow
from tests.unit.test_workflow_poll import (
    _item,
    _make_poll_trigger,
    _make_ready_cloud_workspace as _make_poll_cloud_workspace,
    _make_user as _make_poll_user,
    _make_workflow as _make_poll_workflow,
    _page,
)
from tests.unit.workflow_trigger_test_support import (
    _create_body,
    _make_due,
    _make_ready_cloud_workspace,
    _make_user,
    _make_workflow,
)

pytestmark = pytest.mark.asyncio


async def test_tick_entry_returns_before_due_discovery(
    test_engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:  # type: ignore[no-untyped-def]
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    schedule_scan = AsyncMock()
    poll_scan = AsyncMock()
    monkeypatch.setattr(
        scheduler.trigger_store, "list_due_schedule_trigger_ids", schedule_scan
    )
    monkeypatch.setattr(poller.trigger_store, "list_due_poll_trigger_ids", poll_scan)

    tick = await scheduler.run_workflow_scheduler_tick(session_factory=factory)
    polled = await poller.run_workflow_poller_tick(session_factory=factory)

    assert (tick.created_runs, tick.delivered_runs, polled) == (0, 0, 0)
    schedule_scan.assert_not_awaited()
    poll_scan.assert_not_awaited()


@pytest.mark.parametrize("target_mode", ["local", "personal_cloud"])
async def test_poll_gate_precedes_network_seen_cursor_run_and_action_writes(
    test_engine,
    target_mode: str,
) -> None:  # type: ignore[no-untyped-def]
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as db:
        user = await _make_poll_user(db)
        workflow = await _make_poll_workflow(db, user)
        trigger = await _make_poll_trigger(db, workflow, user, cursor="held-cursor")
        if target_mode == "personal_cloud":
            workspace = await _make_poll_cloud_workspace(db, user)
            trigger.target_mode = target_mode
            trigger.target_workspace_id = workspace.id
            trigger.local_workspace_id = None
        trigger_id = trigger.id
        await db.commit()

    fetch = AsyncMock(return_value=_page([_item("blocked", n=1, title="x")]))
    with (
        patch.object(poller, "fetch_poll_page", new=fetch),
        pytest.raises(CloudApiError) as caught,
    ):
        await poller._poll_one_trigger(factory, trigger_id=trigger_id, now=utcnow())
    assert caught.value.code == "workflow_source_trigger_cutover_required"
    fetch.assert_not_awaited()

    async with factory() as db:
        stored = await db.get(WorkflowTrigger, trigger_id)
        assert stored is not None
        assert stored.poll_cursor == "held-cursor"
        assert stored.last_poll_at is None
        assert await db.scalar(
            select(func.count()).select_from(WorkflowTriggerItem)
        ) == 0
        assert await db.scalar(select(func.count()).select_from(WorkflowRun)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkflowStepAction)) == 0


@pytest.mark.parametrize("target_mode", ["local", "personal_cloud"])
async def test_schedule_gate_preserves_due_cursor_and_writes_no_history_or_actions(
    test_engine,
    target_mode: str,
) -> None:  # type: ignore[no-untyped-def]
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as db, db.begin():
        user = await _make_user(db)
        workflow = await _make_workflow(db, user)
        if target_mode == "personal_cloud":
            await _make_ready_cloud_workspace(db, user)
        trigger = await triggers.create_trigger(
            db,
            user,
            workflow.id,
            _create_body(target_mode=target_mode, args={"issue": "blocked"}),
        )
        trigger_id = trigger.id
    await _make_due(factory, trigger_id)

    async with factory() as db:
        before = await db.get(WorkflowTrigger, trigger_id)
        assert before is not None
        due_cursor = before.next_run_at

    with pytest.raises(CloudApiError) as caught:
        await scheduler._fire_one_trigger(factory, trigger_id=trigger_id, now=utcnow())
    assert caught.value.code == "workflow_source_trigger_cutover_required"

    async with factory() as db:
        stored = await db.get(WorkflowTrigger, trigger_id)
        assert stored is not None
        assert stored.next_run_at == due_cursor
        assert stored.last_scheduled_at is None
        assert stored.last_skipped_at is None
        assert await db.scalar(select(func.count()).select_from(WorkflowRun)) == 0
        assert await db.scalar(select(func.count()).select_from(WorkflowStepAction)) == 0
