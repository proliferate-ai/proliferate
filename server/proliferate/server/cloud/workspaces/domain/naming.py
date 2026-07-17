"""Product naming derivations for cloud workspaces.

Display names are product presentation, not persistence, so their derivation
lives in the workspace domain rather than the SQL store. The store only inserts
already-decided values. This is the one ownership-correct place for the exact
``Workflow run <invocationId>`` scratch naming rule that managed execution (5b)
will reuse.
"""

from __future__ import annotations

from uuid import UUID


def scratch_workspace_display_name(invocation_id: UUID | str) -> str:
    """Display name for a scratch (managed Workflow run) workspace."""
    return f"Workflow run {invocation_id}"
