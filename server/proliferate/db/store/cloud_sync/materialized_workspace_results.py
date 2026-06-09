"""Materialized workspace command-result parsing."""

from __future__ import annotations

import json
from dataclasses import dataclass

from proliferate.constants.cloud import CloudCommandKind, CloudCommandStatus


@dataclass(frozen=True)
class MaterializedWorkspaceResult:
    mode: str
    anyharness_workspace_id: str
    path: str

    @property
    def worktree_path(self) -> str | None:
        return self.path if self.mode == "worktree" else None


def materialized_workspace_result(
    *,
    kind: str,
    status: str,
    result_json: str | None,
) -> MaterializedWorkspaceResult | None:
    if kind != CloudCommandKind.materialize_workspace.value or status not in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
    }:
        return None
    try:
        result = json.loads(result_json or "{}")
    except ValueError:
        return None
    if not isinstance(result, dict):
        return None
    mode = result.get("mode")
    if mode not in {"existing_path", "worktree"}:
        return None
    for field in ("repoRootId", "path", "kind"):
        value = result.get(field)
        if not isinstance(value, str) or not value.strip():
            return None
    workspace_id = result.get("anyharnessWorkspaceId")
    path = result.get("path")
    if (
        not isinstance(workspace_id, str)
        or not workspace_id.strip()
        or not isinstance(path, str)
        or not path.strip()
    ):
        return None
    return MaterializedWorkspaceResult(
        mode=mode,
        anyharness_workspace_id=workspace_id.strip(),
        path=path.strip(),
    )
