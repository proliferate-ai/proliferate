from __future__ import annotations

import asyncio
import logging
from typing import Any
from uuid import UUID

import pytest

from proliferate.server.cloud import provisioning_observability


def _spy_log(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, int, dict[str, Any]]]:
    events: list[tuple[str, int, dict[str, Any]]] = []

    def _capture(message: str, *, level: int = logging.INFO, **fields: Any) -> None:
        events.append((message, level, fields))

    monkeypatch.setattr(provisioning_observability, "log_cloud_event", _capture)
    return events


@pytest.mark.asyncio
async def test_provisioning_phase_logs_start_and_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events = _spy_log(monkeypatch)

    async with provisioning_observability.provisioning_phase(
        scope="workspace_create",
        phase="worktree_create",
        cloud_workspace_id=UUID("12345678-1234-5678-1234-567812345678"),
    ):
        pass

    assert [event[0] for event in events] == [
        "cloud provisioning phase started",
        "cloud provisioning phase finished",
    ]
    assert events[0][2] == {
        "provisioning_scope": "workspace_create",
        "provisioning_phase": "worktree_create",
        "provisioning_outcome": "started",
        "operation_key": None,
        "cloud_sandbox_id": None,
        "repo_environment_id": None,
        "cloud_workspace_id": UUID("12345678-1234-5678-1234-567812345678"),
    }
    assert events[1][1] == logging.INFO
    assert events[1][2]["provisioning_outcome"] == "success"
    assert events[1][2]["elapsed_ms"] >= 0


@pytest.mark.asyncio
async def test_provisioning_phase_logs_only_failure_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events = _spy_log(monkeypatch)

    with pytest.raises(RuntimeError, match="sensitive detail"):
        async with provisioning_observability.provisioning_phase(
            scope="sandbox_operation",
            phase="sandbox_connect",
        ):
            raise RuntimeError("sensitive detail")

    message, level, fields = events[-1]
    assert message == "cloud provisioning phase failed"
    assert level == logging.ERROR
    assert fields["provisioning_outcome"] == "failed"
    assert fields["error_type"] == "RuntimeError"
    assert "sensitive detail" not in repr(events)


@pytest.mark.asyncio
async def test_provisioning_phase_logs_cancellation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events = _spy_log(monkeypatch)

    with pytest.raises(asyncio.CancelledError):
        async with provisioning_observability.provisioning_phase(
            scope="workspace_create",
            phase="repo_root_resolve",
        ):
            raise asyncio.CancelledError

    message, level, fields = events[-1]
    assert message == "cloud provisioning phase cancelled"
    assert level == logging.WARNING
    assert fields["provisioning_outcome"] == "cancelled"
    assert fields["error_type"] == "CancelledError"
