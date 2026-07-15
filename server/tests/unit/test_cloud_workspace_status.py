"""Stalled-materialization detection (T1, issue #949).

A workspace whose AnyHarness worktree write never landed used to report
`materializing` forever (status was derived purely from
`anyharness_workspace_id IS NULL`), spinning the client indefinitely with no
recovery. Past a stall budget it now reports the terminal `error` status with an
actionable detail, so the client stops the spinner and offers delete/recreate.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from proliferate.server.cloud.workspaces import service


def _workspace(*, anyharness_id: str | None, archived: bool, age_seconds: float | None):
    created_at = None
    if age_seconds is not None:
        created_at = datetime.now(UTC) - timedelta(seconds=age_seconds)
    return SimpleNamespace(
        id=uuid.uuid4(),
        anyharness_workspace_id=anyharness_id,
        archived_at=datetime.now(UTC) if archived else None,
        created_at=created_at,
    )


def test_ready_when_anyharness_id_present() -> None:
    ws = _workspace(anyharness_id="ah-1", archived=False, age_seconds=10_000)
    assert service._workspace_status(ws) == "ready"
    assert service._materialization_is_stalled(ws) is False


def test_archived_wins_over_stall() -> None:
    ws = _workspace(anyharness_id=None, archived=True, age_seconds=10_000)
    assert service._workspace_status(ws) == "archived"
    assert service._materialization_is_stalled(ws) is False


def test_recent_no_id_is_materializing() -> None:
    ws = _workspace(anyharness_id=None, archived=False, age_seconds=30)
    assert service._workspace_status(ws) == "materializing"
    assert service._materialization_is_stalled(ws) is False


def test_old_no_id_is_stalled_error() -> None:
    ws = _workspace(
        anyharness_id=None,
        archived=False,
        age_seconds=service.MATERIALIZATION_STALL_SECONDS + 60,
    )
    assert service._materialization_is_stalled(ws) is True
    assert service._workspace_status(ws) == "error"


def test_boundary_just_under_budget_still_materializing() -> None:
    ws = _workspace(
        anyharness_id=None,
        archived=False,
        age_seconds=service.MATERIALIZATION_STALL_SECONDS - 60,
    )
    assert service._workspace_status(ws) == "materializing"


def test_missing_created_at_never_stalls() -> None:
    ws = _workspace(anyharness_id=None, archived=False, age_seconds=None)
    assert service._materialization_is_stalled(ws) is False
    assert service._workspace_status(ws) == "materializing"
