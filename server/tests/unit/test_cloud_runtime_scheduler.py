from __future__ import annotations

import asyncio
from unittest.mock import Mock
from uuid import uuid4

import pytest

from proliferate.server.cloud.runtime import scheduler


@pytest.mark.asyncio
async def test_workspace_provision_task_failures_are_captured_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_id = uuid4()
    capture_mock = Mock()
    logger_error_mock = Mock()

    async def _boom(_workspace_id, *, requested_base_sha=None) -> None:
        raise RuntimeError("provision failed")

    scheduler._provision_tasks.clear()
    monkeypatch.setattr(scheduler, "provision_workspace", _boom)
    monkeypatch.setattr(scheduler, "capture_server_sentry_exception", capture_mock)
    monkeypatch.setattr(scheduler.logger, "error", logger_error_mock)

    scheduler.schedule_workspace_provision(workspace_id)

    task = scheduler._provision_tasks[str(workspace_id)]
    await asyncio.gather(task, return_exceptions=True)
    await asyncio.sleep(0)

    capture_mock.assert_called_once()
    assert capture_mock.call_args.args[0].args == ("provision failed",)
    assert capture_mock.call_args.kwargs["tags"] == {
        "domain": "cloud_runtime",
        "action": "workspace_provision_task",
    }
    assert capture_mock.call_args.kwargs["extras"] == {
        "workspace_id": str(workspace_id),
    }
    logger_error_mock.assert_called_once()
    assert str(workspace_id) not in scheduler._provision_tasks
