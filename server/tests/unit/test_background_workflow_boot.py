"""WS4a/WS4b production-worker boot smoke (spec §6 WF-6; WS4 acceptance).

The Celery worker fleet boots by importing the single Celery app, which imports
every task module. This asserts that boot imports cleanly and the workflow
schedule- and poll-plane tasks register, and that each Beat schedule pair is
gated by its own flag (``workflows_beat_schedules`` / ``workflows_beat_polls``,
both default off -> the legacy loops still own firing/polling).
"""

from __future__ import annotations

from proliferate.background.beat_schedule import build_beat_schedule
from proliferate.background.celery_app import celery_app
from proliferate.background.config import (
    WORKFLOW_DELIVER_OUTBOX_TASK,
    WORKFLOW_FIRE_DUE_POLLS_TASK,
    WORKFLOW_FIRE_DUE_SCHEDULES_TASK,
    WORKFLOW_POLL_NEXT_PAGE_TASK,
)
from proliferate.config import Settings

_ALL_WORKFLOW_TASKS = (
    WORKFLOW_FIRE_DUE_SCHEDULES_TASK,
    WORKFLOW_DELIVER_OUTBOX_TASK,
    WORKFLOW_FIRE_DUE_POLLS_TASK,
    WORKFLOW_POLL_NEXT_PAGE_TASK,
)


def test_celery_app_imports_and_registers_workflow_tasks() -> None:
    task_names = set(celery_app.tasks.keys())
    for task in _ALL_WORKFLOW_TASKS:
        assert task in task_names


def test_workflow_tasks_route_to_a_known_queue() -> None:
    from proliferate.background.config import KNOWN_QUEUE_NAMES, TASK_ROUTES

    for task in _ALL_WORKFLOW_TASKS:
        assert task in TASK_ROUTES
        assert TASK_ROUTES[task]["queue"] in KNOWN_QUEUE_NAMES


def test_beat_schedule_gated_by_flag() -> None:
    off = build_beat_schedule(
        Settings(WORKFLOWS_BEAT_SCHEDULES=False, WORKFLOWS_BEAT_POLLS=False, DEBUG=True)
    )
    assert "workflow-fire-due-schedules" not in off
    assert "workflow-deliver-outbox" not in off
    assert "workflow-fire-due-polls" not in off
    assert "workflow-poll-next-page" not in off

    on = build_beat_schedule(
        Settings(WORKFLOWS_BEAT_SCHEDULES=True, WORKFLOWS_BEAT_POLLS=True, DEBUG=True)
    )
    assert on["workflow-fire-due-schedules"]["task"] == WORKFLOW_FIRE_DUE_SCHEDULES_TASK
    assert on["workflow-deliver-outbox"]["task"] == WORKFLOW_DELIVER_OUTBOX_TASK
    assert on["workflow-fire-due-polls"]["task"] == WORKFLOW_FIRE_DUE_POLLS_TASK
    assert on["workflow-poll-next-page"]["task"] == WORKFLOW_POLL_NEXT_PAGE_TASK


def test_poll_beat_flag_is_independent_of_schedule_flag() -> None:
    """WS4b's flag is a SIBLING of WS4a's, not the same flag — each half of the
    WS4 cutover can flip independently."""

    schedules_only = build_beat_schedule(
        Settings(WORKFLOWS_BEAT_SCHEDULES=True, WORKFLOWS_BEAT_POLLS=False, DEBUG=True)
    )
    assert "workflow-fire-due-schedules" in schedules_only
    assert "workflow-fire-due-polls" not in schedules_only

    polls_only = build_beat_schedule(
        Settings(WORKFLOWS_BEAT_SCHEDULES=False, WORKFLOWS_BEAT_POLLS=True, DEBUG=True)
    )
    assert "workflow-fire-due-polls" in polls_only
    assert "workflow-fire-due-schedules" not in polls_only
