"""Selection preference, redaction, and source-preflight (pure functions)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from proliferate.db.store.cloud_workspace_materializations import (
    CloudWorkspaceMaterializationValue,
)
from proliferate.integrations.anyharness.models import RemoteGitStatusSnapshot
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces.materializations.service import (
    _require_clean_publishable_source,
)
from proliferate.server.cloud.workspaces.materializations.summaries import (
    materialization_summary,
    operation_id_for,
    select_primary,
)


def _value(
    *,
    target_kind: str,
    state: str = "hydrated",
    desktop_install_id: str | None = None,
    anyharness_workspace_id: str | None = "ah-1",
    worktree_path: str | None = "/w/path",
    generation: int = 1,
) -> CloudWorkspaceMaterializationValue:
    now = datetime.now(UTC)
    return CloudWorkspaceMaterializationValue(
        id=uuid.uuid4(),
        cloud_workspace_id=uuid.uuid4(),
        target_kind=target_kind,
        cloud_sandbox_id=None,
        desktop_install_id=desktop_install_id,
        anyharness_workspace_id=anyharness_workspace_id,
        worktree_path=worktree_path,
        state=state,
        generation=generation,
        expected_head_sha="abc",
        observed_head_sha="abc",
        observed_branch="feature/x",
        failure_code=None,
        failure_detail=None,
        last_reported_at=now,
        unlinked_at=None,
        created_at=now,
        updated_at=now,
    )


def _snapshot(**overrides: object) -> RemoteGitStatusSnapshot:
    base = dict(
        workspace_id="ws-1",
        workspace_path="/w/ws-1",
        repo_root_path="/w",
        current_branch="feature/x",
        head_oid="abc123",
        detached=False,
        upstream_branch="origin/feature/x",
        suggested_base_branch="main",
        ahead=0,
        behind=0,
        operation="none",
        conflicted=False,
        clean=True,
    )
    base.update(overrides)
    return RemoteGitStatusSnapshot(**base)  # type: ignore[arg-type]


def test_redacts_other_install_local_path_runtime_id_and_install_id() -> None:
    value = _value(target_kind="local_desktop", desktop_install_id="mac-b")
    summary = materialization_summary(value, requesting_desktop_install_id="mac-a")
    assert summary.worktree_path is None
    assert summary.anyharness_workspace_id is None
    # PR4-INSTALL-04: the other install's id itself is redacted so a caller
    # cannot enumerate + re-submit it to un-redact that device's identity.
    assert summary.desktop_install_id is None
    # Presence/health still disclosed.
    assert summary.state == "hydrated"


def test_does_not_redact_own_install() -> None:
    value = _value(target_kind="local_desktop", desktop_install_id="mac-a")
    summary = materialization_summary(value, requesting_desktop_install_id="mac-a")
    assert summary.worktree_path == "/w/path"
    assert summary.anyharness_workspace_id == "ah-1"
    assert summary.desktop_install_id == "mac-a"


def test_managed_cloud_never_redacted() -> None:
    value = _value(target_kind="managed_cloud")
    summary = materialization_summary(value, requesting_desktop_install_id="mac-a")
    assert summary.worktree_path == "/w/path"


def test_select_prefers_owned_healthy_local() -> None:
    managed = _value(target_kind="managed_cloud")
    local = _value(target_kind="local_desktop", desktop_install_id="mac-a", state="hydrated")
    chosen = select_primary([managed, local], requesting_desktop_install_id="mac-a")
    assert chosen is local


def test_select_prefers_managed_when_local_not_healthy() -> None:
    managed = _value(target_kind="managed_cloud")
    local = _value(target_kind="local_desktop", desktop_install_id="mac-a", state="failed")
    chosen = select_primary([managed, local], requesting_desktop_install_id="mac-a")
    assert chosen is managed


def test_select_prefers_managed_without_install() -> None:
    managed = _value(target_kind="managed_cloud")
    local = _value(target_kind="local_desktop", desktop_install_id="mac-a")
    chosen = select_primary([local, managed], requesting_desktop_install_id=None)
    assert chosen is managed


def test_operation_id_combines_id_and_generation() -> None:
    value = _value(target_kind="local_desktop", desktop_install_id="mac-a", generation=3)
    assert operation_id_for(value) == f"{value.id}:3"


def test_clean_publishable_source_returns_branch() -> None:
    assert _require_clean_publishable_source(_snapshot()) == "feature/x"


@pytest.mark.parametrize(
    "overrides",
    [
        {"detached": True, "current_branch": None},
        {"operation": "rebase"},
        {"conflicted": True},
        {"clean": False},
        {"upstream_branch": None},
        {"ahead": 1},
        {"behind": 2},
    ],
)
def test_blocked_sources_raise(overrides: dict[str, object]) -> None:
    with pytest.raises(CloudApiError) as excinfo:
        _require_clean_publishable_source(_snapshot(**overrides))
    assert excinfo.value.code == "materialization_source_blocked"
