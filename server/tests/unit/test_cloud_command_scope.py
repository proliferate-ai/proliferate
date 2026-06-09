from __future__ import annotations

from types import SimpleNamespace
import json
import uuid

from proliferate.constants.cloud import CloudCommandKind
from proliferate.db.store.cloud_sync.command_scope import (
    command_allows_cloud_workspace_scope,
    command_requires_managed_workspace_for_target,
)


def test_managed_materialize_existing_path_can_be_unscoped() -> None:
    target = SimpleNamespace(
        kind="managed_cloud",
        sandbox_profile_id=uuid.uuid4(),
        profile_target_role="primary",
        archived_at=None,
    )

    assert not command_requires_managed_workspace_for_target(
        kind=CloudCommandKind.materialize_workspace.value,
        payload_json=json.dumps({"mode": "existing_path", "path": "/workspace/repo"}),
        target=target,
    )
    assert command_requires_managed_workspace_for_target(
        kind=CloudCommandKind.materialize_workspace.value,
        payload_json=json.dumps({"mode": "worktree"}),
        target=target,
    )
    assert command_requires_managed_workspace_for_target(
        kind=CloudCommandKind.backfill_exposed_workspace.value,
        payload_json="{}",
        target=target,
    )


def test_existing_path_materialize_cannot_scope_cloud_workspace() -> None:
    assert not command_allows_cloud_workspace_scope(
        kind=CloudCommandKind.materialize_workspace.value,
        payload_json=json.dumps({"mode": "existing_path", "path": "/workspace/repo"}),
    )
    assert command_allows_cloud_workspace_scope(
        kind=CloudCommandKind.materialize_workspace.value,
        payload_json=json.dumps({"mode": "worktree"}),
    )
