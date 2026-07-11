"""WS4a production-worker boot smoke (spec §6 WF-6; WS4 acceptance).

The Celery worker fleet boots by importing the single Celery app, which imports
every task module. This asserts that boot imports cleanly and the workflow
schedule-plane tasks register, and that the Beat schedule for them is gated by
``workflows_beat_schedules`` (default off -> legacy loop still owns firing).
"""

from __future__ import annotations

from proliferate.background.beat_schedule import build_beat_schedule
from proliferate.background.celery_app import celery_app
from proliferate.background.config import (
    WORKFLOW_DELIVER_OUTBOX_TASK,
    WORKFLOW_FIRE_DUE_SCHEDULES_TASK,
)
from proliferate.config import Settings


def test_celery_app_imports_and_registers_workflow_tasks() -> None:
    task_names = set(celery_app.tasks.keys())
    assert WORKFLOW_FIRE_DUE_SCHEDULES_TASK in task_names
    assert WORKFLOW_DELIVER_OUTBOX_TASK in task_names


def test_workflow_tasks_route_to_a_known_queue() -> None:
    from proliferate.background.config import KNOWN_QUEUE_NAMES, TASK_ROUTES

    for task in (WORKFLOW_FIRE_DUE_SCHEDULES_TASK, WORKFLOW_DELIVER_OUTBOX_TASK):
        assert task in TASK_ROUTES
        assert TASK_ROUTES[task]["queue"] in KNOWN_QUEUE_NAMES


def test_beat_schedule_gated_by_flag() -> None:
    off = build_beat_schedule(Settings(WORKFLOWS_BEAT_SCHEDULES=False, DEBUG=True))
    assert "workflow-fire-due-schedules" not in off
    assert "workflow-deliver-outbox" not in off

    on = build_beat_schedule(Settings(WORKFLOWS_BEAT_SCHEDULES=True, DEBUG=True))
    assert on["workflow-fire-due-schedules"]["task"] == WORKFLOW_FIRE_DUE_SCHEDULES_TASK
    assert on["workflow-deliver-outbox"]["task"] == WORKFLOW_DELIVER_OUTBOX_TASK
