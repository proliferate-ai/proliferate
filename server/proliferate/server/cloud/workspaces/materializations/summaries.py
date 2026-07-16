"""Serialization, redaction, and selection for materialization ledger rows.

Pure functions over store values; no I/O. Redaction and selection are here so
the read-path (``_workspace_payload``) and the intent/report/unlink write-path
share one source of truth for how a materialization is presented to a caller.
"""

from __future__ import annotations

from proliferate.db.store.cloud_workspace_materializations import (
    CloudWorkspaceMaterializationValue,
)
from proliferate.server.cloud.workspaces.models import WorkspaceMaterializationSummary

_HEALTHY_LOCAL_STATES = {"hydrated"}


def materialization_summary(
    value: CloudWorkspaceMaterializationValue,
    *,
    requesting_desktop_install_id: str | None,
) -> WorkspaceMaterializationSummary:
    """Serialize one active materialization, redacting other installs' identity.

    For a ``local_desktop`` row whose install does not match the request, we
    disclose presence and health but never the worktree path, AnyHarness id, or
    the install id itself of another device. Echoing the raw ``desktopInstallId``
    of every same-user install let any authenticated session enumerate other
    machines' install ids and re-submit them to un-redact their worktree
    path/runtime id (see PR4-INSTALL-04). PR 5's projection only ever matches a
    local row against the caller's OWN install id, so a nulled id for
    non-matching rows changes no legitimate client behavior. The owning install
    (matching request) still sees its own id.
    """
    redact = (
        value.target_kind == "local_desktop"
        and value.desktop_install_id != requesting_desktop_install_id
    )
    return WorkspaceMaterializationSummary(
        id=str(value.id),
        target_kind=value.target_kind,  # type: ignore[arg-type]
        desktop_install_id=None if redact else value.desktop_install_id,
        anyharness_workspace_id=None if redact else value.anyharness_workspace_id,
        worktree_path=None if redact else value.worktree_path,
        state=value.state,  # type: ignore[arg-type]
        generation=value.generation,
        expected_head_sha=value.expected_head_sha,
        observed_head_sha=value.observed_head_sha,
        observed_branch=value.observed_branch,
        failure_code=value.failure_code,
        last_reported_at=(value.last_reported_at.isoformat() if value.last_reported_at else None),
    )


def select_primary(
    values: list[CloudWorkspaceMaterializationValue],
    *,
    requesting_desktop_install_id: str | None,
) -> CloudWorkspaceMaterializationValue | None:
    """Pick the selected materialization for a request.

    When the request supplies an owned ``desktopInstallId`` and that install has
    a healthy (hydrated) local row, prefer it; otherwise prefer managed Cloud.
    Falls back to any managed row, then any row.
    """
    if requesting_desktop_install_id is not None:
        for value in values:
            if (
                value.target_kind == "local_desktop"
                and value.desktop_install_id == requesting_desktop_install_id
                and value.state in _HEALTHY_LOCAL_STATES
            ):
                return value
    for value in values:
        if value.target_kind == "managed_cloud":
            return value
    return values[0] if values else None


def operation_id_for(value: CloudWorkspaceMaterializationValue) -> str:
    """Operation id derived from the row id + generation (stable per attempt)."""
    return f"{value.id}:{value.generation}"
