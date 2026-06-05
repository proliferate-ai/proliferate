from __future__ import annotations

import json

from proliferate.db.models.cloud.mobility import (
    CloudWorkspaceHandoffOp,
    CloudWorkspaceMobility,
    CloudWorkspaceMoveCleanupItem,
)
from proliferate.db.store.cloud_mobility.records import (
    CloudWorkspaceHandoffOpValue,
    CloudWorkspaceMobilityValue,
    CloudWorkspaceMoveCleanupItemValue,
)


def _decode_exclude_paths(raw: str | None) -> tuple[str, ...]:
    try:
        decoded = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return ()
    if not isinstance(decoded, list):
        return ()
    return tuple(item for item in decoded if isinstance(item, str) and item.strip())


def _normalize_owner(owner: str) -> str:
    return "personal_cloud" if owner == "cloud" else owner


def _active_lifecycle_state_for_owner(owner: str) -> str:
    return {
        "local": "local_active",
        "personal_cloud": "cloud_active",
        "shared_cloud": "shared_cloud_active",
        "ssh": "ssh_active",
    }.get(_normalize_owner(owner), "cloud_active")


def _handoff_value(record: CloudWorkspaceHandoffOp) -> CloudWorkspaceHandoffOpValue:
    return CloudWorkspaceHandoffOpValue(
        id=record.id,
        mobility_workspace_id=record.mobility_workspace_id,
        user_id=record.user_id,
        direction=record.direction,
        source_owner=_normalize_owner(record.source_owner),
        target_owner=_normalize_owner(record.target_owner),
        phase=record.phase,
        canonical_side=record.canonical_side,
        requested_branch=record.requested_branch,
        requested_base_sha=record.requested_base_sha,
        exclude_paths=_decode_exclude_paths(record.exclude_paths_json),
        failure_code=record.failure_code,
        failure_detail=record.failure_detail,
        started_at=record.started_at,
        heartbeat_at=record.heartbeat_at,
        finalized_at=record.finalized_at,
        cleanup_completed_at=record.cleanup_completed_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _cleanup_item_value(
    record: CloudWorkspaceMoveCleanupItem,
) -> CloudWorkspaceMoveCleanupItemValue:
    return CloudWorkspaceMoveCleanupItemValue(
        id=record.id,
        handoff_op_id=record.handoff_op_id,
        item_kind=record.item_kind,
        target_id=record.target_id,
        anyharness_workspace_id=record.anyharness_workspace_id,
        object_id=record.object_id,
        status=record.status,
        attempt_count=record.attempt_count,
        next_attempt_at=record.next_attempt_at,
        error_code=record.error_code,
        error_message=record.error_message,
        started_at=record.started_at,
        completed_at=record.completed_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _mobility_value(
    record: CloudWorkspaceMobility,
    *,
    active_handoff: CloudWorkspaceHandoffOp | None = None,
) -> CloudWorkspaceMobilityValue:
    return CloudWorkspaceMobilityValue(
        id=record.id,
        user_id=record.user_id,
        display_name=record.display_name,
        git_provider=record.git_provider,
        git_owner=record.git_owner,
        git_repo_name=record.git_repo_name,
        git_branch=record.git_branch,
        owner=_normalize_owner(record.owner),
        lifecycle_state=record.lifecycle_state,
        status_detail=record.status_detail,
        last_error=record.last_error,
        cloud_workspace_id=record.cloud_workspace_id,
        active_handoff_op_id=record.active_handoff_op_id,
        last_handoff_op_id=record.last_handoff_op_id,
        cloud_lost_at=record.cloud_lost_at,
        cloud_lost_reason=record.cloud_lost_reason,
        created_at=record.created_at,
        updated_at=record.updated_at,
        active_handoff=(_handoff_value(active_handoff) if active_handoff is not None else None),
    )
