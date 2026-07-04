"""Unit tests for cloud workspace status derivation with staleness detection."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from proliferate.db.store.cloud_workspaces import CloudWorkspaceValue
from proliferate.server.cloud.workspaces.service import (
    _MATERIALIZATION_STALL_DEADLINE,
    _workspace_status,
)


def _make_workspace(
    *,
    anyharness_workspace_id: str | None = None,
    created_at: datetime | None = None,
    archived_at: datetime | None = None,
) -> CloudWorkspaceValue:
    now = datetime.now(timezone.utc)
    return CloudWorkspaceValue(
        id=uuid4(),
        owner_user_id=uuid4(),
        repo_environment_id=uuid4(),
        display_name="test-workspace",
        git_branch="feat/test",
        git_base_branch="main",
        anyharness_workspace_id=anyharness_workspace_id,
        created_at=created_at or now,
        updated_at=created_at or now,
        archived_at=archived_at,
    )


def test_ready_when_anyharness_workspace_id_present() -> None:
    workspace = _make_workspace(anyharness_workspace_id="ws_123")
    assert _workspace_status(workspace) == "ready"


def test_archived_when_archived_at_set() -> None:
    workspace = _make_workspace(
        anyharness_workspace_id=None,
        archived_at=datetime.now(timezone.utc),
    )
    assert _workspace_status(workspace) == "archived"


def test_materializing_within_deadline() -> None:
    # Created 5 minutes ago, well within the 15-minute deadline.
    workspace = _make_workspace(
        created_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    )
    assert _workspace_status(workspace) == "materializing"


def test_materialization_stalled_beyond_deadline() -> None:
    # Created well beyond the deadline.
    workspace = _make_workspace(
        created_at=datetime.now(timezone.utc) - _MATERIALIZATION_STALL_DEADLINE - timedelta(seconds=1),
    )
    assert _workspace_status(workspace) == "materialization_stalled"


def test_materialization_not_stalled_just_under_deadline() -> None:
    # Just under the deadline should still report materializing.
    workspace = _make_workspace(
        created_at=datetime.now(timezone.utc) - _MATERIALIZATION_STALL_DEADLINE + timedelta(seconds=5),
    )
    assert _workspace_status(workspace) == "materializing"


def test_archived_takes_precedence_over_stalled() -> None:
    # Even if the workspace would be stalled, archived takes priority.
    workspace = _make_workspace(
        created_at=datetime.now(timezone.utc) - timedelta(hours=2),
        archived_at=datetime.now(timezone.utc),
    )
    assert _workspace_status(workspace) == "archived"
