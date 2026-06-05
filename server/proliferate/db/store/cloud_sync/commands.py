"""Cloud command persistence."""

from __future__ import annotations

import json
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    SUPPORTED_CLOUD_AGENTS,
    CloudCommandKind,
    CloudCommandStatus,
    CloudWorkspaceCleanupState,
    CloudWorkspaceStatus,
)
from proliferate.db.models.cloud.commands import CloudCommand
from proliferate.db.models.cloud.sync import CloudSessionProjection
from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_sync import worker_control
from proliferate.db.store.cloud_sync.command_records import (
    CloudCommandSnapshot,
    is_terminal_status,
    snapshot_command,
)
from proliferate.db.store.cloud_sync.command_scope import (
    cloud_workspace_matches_command,
    command_requires_managed_workspace,
    leased_target_is_stale,
    load_active_workspace_exposure,
    target_is_managed_cloud,
    workspace_matches_command_target,
)
from proliferate.utils.time import utcnow

ARCHIVE_SUPERSEDED_COMMAND_KINDS: frozenset[str] = frozenset(
    (
        CloudCommandKind.start_session.value,
        CloudCommandKind.send_prompt.value,
        CloudCommandKind.decide_plan.value,
        CloudCommandKind.resolve_interaction.value,
        CloudCommandKind.update_session_config.value,
        CloudCommandKind.cancel_turn.value,
        CloudCommandKind.close_session.value,
        CloudCommandKind.materialize_workspace.value,
        CloudCommandKind.backfill_exposed_workspace.value,
    )
)

SUPERSEDABLE_COMMAND_STATUSES: tuple[str, ...] = (
    CloudCommandStatus.queued.value,
    CloudCommandStatus.leased.value,
)


async def create_command(
    db: AsyncSession,
    *,
    idempotency_scope: str,
    idempotency_key: str,
    target_id: UUID,
    organization_id: UUID | None,
    actor_user_id: UUID | None,
    actor_kind: str,
    source: str,
    workspace_id: str | None,
    session_id: str | None,
    cloud_workspace_id: UUID | None,
    kind: str,
    payload_json: str,
    observed_event_seq: int | None,
    preconditions_json: str | None,
    authorization_context_json: str | None,
) -> CloudCommandSnapshot:
    now = utcnow()
    target = await db.get(CloudTarget, target_id)
    if (
        kind
        in {
            CloudCommandKind.materialize_workspace.value,
            CloudCommandKind.backfill_exposed_workspace.value,
        }
        and target_is_managed_cloud(target)
        and cloud_workspace_id is None
    ):
        raise RuntimeError(f"Managed {kind} commands require cloud_workspace_id.")
    if kind == CloudCommandKind.backfill_exposed_workspace.value and cloud_workspace_id is None:
        raise RuntimeError("backfill_exposed_workspace commands require cloud_workspace_id.")
    row = CloudCommand(
        idempotency_scope=idempotency_scope,
        idempotency_key=idempotency_key,
        target_id=target_id,
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        actor_kind=actor_kind,
        source=source,
        workspace_id=workspace_id,
        cloud_workspace_id=cloud_workspace_id,
        session_id=session_id,
        kind=kind,
        payload_json=payload_json,
        observed_event_seq=observed_event_seq,
        preconditions_json=preconditions_json,
        authorization_context_json=authorization_context_json,
        status=CloudCommandStatus.queued.value,
        attempt_count=0,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    await worker_control.bump_control_revision(db, target_id=target_id, now=now)
    return snapshot_command(row)


async def get_command_by_id(
    db: AsyncSession,
    command_id: UUID,
) -> CloudCommandSnapshot | None:
    row = await db.get(CloudCommand, command_id)
    return snapshot_command(row) if row is not None else None


async def get_command_by_idempotency(
    db: AsyncSession,
    *,
    idempotency_scope: str,
    idempotency_key: str,
) -> CloudCommandSnapshot | None:
    row = (
        await db.execute(
            select(CloudCommand)
            .where(CloudCommand.idempotency_scope == idempotency_scope)
            .where(CloudCommand.idempotency_key == idempotency_key)
        )
    ).scalar_one_or_none()
    return snapshot_command(row) if row is not None else None


async def count_active_commands_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> int:
    count_value = (
        await db.execute(
            select(func.count(CloudCommand.id))
            .where(CloudCommand.target_id == target_id)
            .where(
                CloudCommand.status.in_(
                    (
                        CloudCommandStatus.queued.value,
                        CloudCommandStatus.leased.value,
                        CloudCommandStatus.delivered.value,
                    )
                )
            )
        )
    ).scalar_one()
    return int(count_value or 0)


async def expire_command_if_not_terminal(
    db: AsyncSession,
    *,
    command_id: UUID,
    error_code: str | None,
    error_message: str | None,
    now: datetime,
    eligible_statuses: tuple[str, ...] | None = None,
) -> CloudCommandSnapshot | None:
    row = (
        await db.execute(
            select(CloudCommand).where(CloudCommand.id == command_id).with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    if is_terminal_status(row.status):
        return snapshot_command(row)
    if eligible_statuses is not None and row.status not in eligible_statuses:
        return snapshot_command(row)
    row.status = CloudCommandStatus.expired.value
    row.expired_at = now
    row.error_code = error_code
    row.error_message = error_message
    row.updated_at = now
    await db.flush()
    await worker_control.bump_control_revision(db, target_id=row.target_id, now=now)
    return snapshot_command(row)


async def expire_stale_queued_commands(
    db: AsyncSession,
    *,
    target_id: UUID | None = None,
    source: str | None = None,
    command_kinds: frozenset[str] | tuple[str, ...] | None = None,
    older_than: datetime,
    error_code: str,
    error_message: str,
    now: datetime,
) -> tuple[CloudCommandSnapshot, ...]:
    query = select(CloudCommand).where(
        or_(
            and_(
                CloudCommand.status == CloudCommandStatus.queued.value,
                CloudCommand.created_at <= older_than,
            ),
            and_(
                CloudCommand.status == CloudCommandStatus.leased.value,
                CloudCommand.created_at <= older_than,
                CloudCommand.lease_expires_at.is_not(None),
                CloudCommand.lease_expires_at <= now,
            ),
            and_(
                CloudCommand.status == CloudCommandStatus.delivered.value,
                CloudCommand.created_at <= older_than,
                CloudCommand.lease_expires_at.is_not(None),
                CloudCommand.lease_expires_at <= now,
            ),
        )
    )
    if target_id is not None:
        query = query.where(CloudCommand.target_id == target_id)
    if source is not None:
        query = query.where(CloudCommand.source == source)
    if command_kinds is not None:
        query = query.where(CloudCommand.kind.in_(tuple(command_kinds)))
    rows = list(
        (
            await db.execute(
                query.with_for_update().order_by(
                    CloudCommand.created_at.asc(), CloudCommand.id.asc()
                )
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        row.status = CloudCommandStatus.expired.value
        row.expired_at = now
        row.error_code = error_code
        row.error_message = error_message
        row.updated_at = now
    await db.flush()
    for expired_target_id in {row.target_id for row in rows}:
        await worker_control.bump_control_revision(db, target_id=expired_target_id, now=now)
    return tuple(snapshot_command(row) for row in rows)


async def supersede_workspace_commands(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID,
    reason_code: str,
    reason_message: str,
    command_kinds: frozenset[str] | tuple[str, ...] | None = ARCHIVE_SUPERSEDED_COMMAND_KINDS,
    now: datetime | None = None,
) -> tuple[CloudCommandSnapshot, ...]:
    """Terminally supersede queued/leased commands for a workspace lifecycle change."""

    marked_at = now or utcnow()
    query = (
        select(CloudCommand)
        .where(CloudCommand.cloud_workspace_id == cloud_workspace_id)
        .where(CloudCommand.status.in_(SUPERSEDABLE_COMMAND_STATUSES))
    )
    if command_kinds is not None:
        query = query.where(CloudCommand.kind.in_(tuple(command_kinds)))
    rows = list(
        (
            await db.execute(
                query.with_for_update().order_by(
                    CloudCommand.created_at.asc(), CloudCommand.id.asc()
                )
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        row.status = CloudCommandStatus.superseded.value
        row.error_code = reason_code
        row.error_message = reason_message
        row.lease_expires_at = None
        row.updated_at = marked_at
    await db.flush()
    for superseded_target_id in {row.target_id for row in rows}:
        await worker_control.bump_control_revision(
            db,
            target_id=superseded_target_id,
            now=marked_at,
        )
    return tuple(snapshot_command(row) for row in rows)


async def mark_command_delivered(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    lease_id: str,
    now: datetime,
) -> CloudCommandSnapshot | None:
    row = await _get_worker_leased_command(
        db,
        command_id=command_id,
        worker_id=worker_id,
        lease_id=lease_id,
    )
    if row is None:
        return None
    if row.status == CloudCommandStatus.delivered.value:
        return snapshot_command(row)
    if is_terminal_status(row.status) or row.status != CloudCommandStatus.leased.value:
        return None
    if await leased_target_is_stale(db, row, worker_id=worker_id):
        row.status = CloudCommandStatus.superseded.value
        row.error_code = "stale_target"
        row.error_message = "Command delivery came from an archived or mismatched target."
        row.updated_at = now
        await db.flush()
        return snapshot_command(row)
    row.status = CloudCommandStatus.delivered.value
    row.delivered_at = now
    row.updated_at = now
    await db.flush()
    return snapshot_command(row)


async def mark_command_failed_delivery(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    lease_id: str,
    error_code: str | None,
    error_message: str | None,
    now: datetime,
) -> CloudCommandSnapshot | None:
    row = await _get_worker_leased_command(
        db,
        command_id=command_id,
        worker_id=worker_id,
        lease_id=lease_id,
    )
    if row is None:
        return None
    if is_terminal_status(row.status):
        return snapshot_command(row)
    if row.status not in {
        CloudCommandStatus.leased.value,
        CloudCommandStatus.delivered.value,
    }:
        return None
    if await leased_target_is_stale(db, row, worker_id=worker_id):
        row.status = CloudCommandStatus.superseded.value
        row.error_code = "stale_target"
        row.error_message = "Command delivery came from an archived or mismatched target."
        row.updated_at = now
        await db.flush()
        return snapshot_command(row)
    row.status = CloudCommandStatus.failed_delivery.value
    row.error_code = error_code
    row.error_message = error_message
    row.updated_at = now
    await db.flush()
    return snapshot_command(row)


async def mark_queued_commands_failed_delivery_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
    command_kinds: frozenset[str],
    error_code: str,
    error_message: str,
    now: datetime,
) -> tuple[CloudCommandSnapshot, ...]:
    rows = list(
        (
            await db.execute(
                select(CloudCommand)
                .where(
                    CloudCommand.target_id == target_id,
                    CloudCommand.status == CloudCommandStatus.queued.value,
                    CloudCommand.kind.in_(command_kinds),
                )
                .with_for_update()
                .order_by(CloudCommand.created_at.asc(), CloudCommand.id.asc())
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        row.status = CloudCommandStatus.failed_delivery.value
        row.error_code = error_code
        row.error_message = error_message
        row.updated_at = now
    await db.flush()
    return tuple(snapshot_command(row) for row in rows)


async def record_command_result(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    lease_id: str,
    status: str,
    error_code: str | None,
    error_message: str | None,
    result_json: str | None,
    cloud_workspace_id: UUID | None,
    anyharness_workspace_id: str | None,
    now: datetime,
) -> CloudCommandSnapshot | None:
    row = await _get_worker_leased_command(
        db,
        command_id=command_id,
        worker_id=worker_id,
        lease_id=lease_id,
    )
    if row is None:
        return None
    if is_terminal_status(row.status):
        return snapshot_command(row)
    if row.status not in {
        CloudCommandStatus.leased.value,
        CloudCommandStatus.delivered.value,
    }:
        return None
    stale_target = await leased_target_is_stale(db, row, worker_id=worker_id)
    if stale_target:
        row.status = CloudCommandStatus.superseded.value
        row.error_code = "stale_target"
        row.error_message = "Command result came from an archived or mismatched target."
        row.updated_at = now
        await db.flush()
        return snapshot_command(row)
    requires_managed_workspace = await command_requires_managed_workspace(db, row)
    effective_status = status
    effective_error_code = error_code
    effective_error_message = error_message
    materialized_workspace_id = _materialized_workspace_id(
        kind=row.kind,
        status=status,
        result_json=result_json,
    )
    result_cloud_workspace_id = cloud_workspace_id or _result_cloud_workspace_id(result_json)
    if (
        row.kind == CloudCommandKind.materialize_workspace.value
        and requires_managed_workspace
        and row.cloud_workspace_id is None
    ):
        effective_status = CloudCommandStatus.rejected.value
        effective_error_code = "cloud_workspace_required"
        effective_error_message = (
            "Managed materialize_workspace command is missing Cloud workspace."
        )
    elif (
        row.kind == CloudCommandKind.materialize_workspace.value
        and row.cloud_workspace_id is not None
        and (
            result_cloud_workspace_id is None
            or result_cloud_workspace_id != row.cloud_workspace_id
            or not await cloud_workspace_matches_command(db, row)
        )
    ):
        effective_status = CloudCommandStatus.rejected.value
        effective_error_code = "cloud_workspace_not_found"
        effective_error_message = "materialize_workspace result does not match a Cloud workspace."
    elif (
        row.kind == CloudCommandKind.materialize_workspace.value
        and status
        in {
            CloudCommandStatus.accepted.value,
            CloudCommandStatus.accepted_but_queued.value,
        }
        and materialized_workspace_id is None
    ):
        effective_status = CloudCommandStatus.rejected.value
        effective_error_code = "invalid_materialize_workspace_result"
        effective_error_message = "materialize_workspace result is missing required stable fields."
    row.status = effective_status
    row.error_code = effective_error_code
    row.error_message = effective_error_message
    row.result_json = _safe_result_json(kind=row.kind, result_json=result_json)
    if materialized_workspace_id is not None:
        row.workspace_id = materialized_workspace_id
    if anyharness_workspace_id is not None:
        row.workspace_id = anyharness_workspace_id
    row.updated_at = now
    if effective_status in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
    }:
        row.accepted_at = now
        row.rejected_at = None
    elif effective_status in {
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.failed_delivery.value,
    }:
        row.rejected_at = now
    await db.flush()
    if (
        row.kind == CloudCommandKind.materialize_workspace.value
        and effective_status
        in {
            CloudCommandStatus.accepted.value,
            CloudCommandStatus.accepted_but_queued.value,
        }
        and row.cloud_workspace_id is not None
        and (materialized_workspace_id or anyharness_workspace_id)
    ):
        await _record_materialized_cloud_workspace(
            db,
            cloud_workspace_id=row.cloud_workspace_id,
            anyharness_workspace_id=anyharness_workspace_id or materialized_workspace_id or "",
            target_id=row.target_id,
            now=now,
        )
    if row.kind == CloudCommandKind.prune_workspace_worktree.value and effective_status in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
    }:
        await _record_pruned_cloud_workspace(
            db,
            row=row,
            result_json=result_json,
            now=now,
        )
    if row.kind == CloudCommandKind.start_session.value and effective_status in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
    }:
        await _record_started_cloud_session_projection(
            db,
            row=row,
            result_json=result_json,
            now=now,
        )
    return snapshot_command(row)


async def _record_materialized_cloud_workspace(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID,
    anyharness_workspace_id: str,
    target_id: UUID,
    now: datetime,
) -> None:
    workspace = await db.get(CloudWorkspace, cloud_workspace_id)
    if workspace is None:
        return
    workspace.anyharness_workspace_id = anyharness_workspace_id
    workspace.target_id = target_id
    workspace.materialized_target_id = target_id
    workspace.status = "ready"
    workspace.status_detail = "Ready"
    workspace.ready_at = now
    workspace.updated_at = now
    if workspace.target_id is not None:
        exposure = await load_active_workspace_exposure(
            db,
            target_id=workspace.target_id,
            cloud_workspace_id=workspace.id,
        )
        if exposure is not None and exposure.status == "active":
            changed = False
            if exposure.anyharness_workspace_id != anyharness_workspace_id:
                exposure.anyharness_workspace_id = anyharness_workspace_id
                changed = True
            if exposure.origin != workspace.origin:
                exposure.origin = workspace.origin
                changed = True
            if workspace.archived_at is None and not exposure.commandable:
                exposure.commandable = True
                changed = True
            if changed:
                exposure.revision += 1
                exposure.updated_at = now
    await db.flush()


async def _record_pruned_cloud_workspace(
    db: AsyncSession,
    *,
    row: CloudCommand,
    result_json: str | None,
    now: datetime,
) -> None:
    if row.cloud_workspace_id is None:
        _mark_command_rejected(
            row,
            code="cloud_workspace_required",
            message="prune_workspace_worktree command is missing Cloud workspace.",
            now=now,
        )
        await db.flush()
        return
    result = _result_dict(result_json)
    if result is None:
        _mark_command_rejected(
            row,
            code="invalid_prune_workspace_result",
            message="prune_workspace_worktree result is missing materialization state.",
            now=now,
        )
        await db.flush()
        return
    workspace = await db.get(CloudWorkspace, row.cloud_workspace_id)
    if workspace is None or not await workspace_matches_command_target(
        db,
        workspace=workspace,
        row=row,
    ):
        _mark_command_rejected(
            row,
            code="cloud_workspace_not_found",
            message="prune_workspace_worktree result does not match a Cloud workspace.",
            now=now,
        )
        await db.flush()
        return

    expected_workspace_id = (
        _result_string(result, "anyharnessWorkspaceId")
        or _result_body_workspace_id(result)
        or row.workspace_id
    )
    if (
        expected_workspace_id
        and workspace.anyharness_workspace_id is not None
        and workspace.anyharness_workspace_id != expected_workspace_id
    ):
        row.status = CloudCommandStatus.superseded.value
        row.error_code = "stale_materialization"
        row.error_message = "Prune result does not match the current workspace materialization."
        row.accepted_at = None
        row.rejected_at = None
        row.updated_at = now
        await db.flush()
        return

    state = (_result_string(result, "materializationState") or "").lower()
    cleanup_status = (_result_string(result, "cleanupStatus") or "").lower()
    cleanup_error = _prune_cleanup_error(result)
    if state == "dehydrated" or cleanup_status in {"completed", "complete"}:
        workspace.anyharness_workspace_id = None
        workspace.worktree_path = None
        workspace.status = (
            CloudWorkspaceStatus.archived.value
            if workspace.archived_at is not None
            else CloudWorkspaceStatus.needs_rematerialization.value
        )
        workspace.status_detail = (
            "Archived" if workspace.archived_at is not None else "Worktree pruned"
        )
        workspace.cleanup_state = CloudWorkspaceCleanupState.complete.value
        workspace.cleanup_last_error = None
        workspace.updated_at = now
        if workspace.target_id is not None:
            exposure = await load_active_workspace_exposure(
                db,
                target_id=workspace.target_id,
                cloud_workspace_id=workspace.id,
            )
            if exposure is not None and (
                expected_workspace_id is None
                or exposure.anyharness_workspace_id == expected_workspace_id
            ):
                changed = False
                if exposure.anyharness_workspace_id is not None:
                    exposure.anyharness_workspace_id = None
                    changed = True
                if exposure.commandable:
                    exposure.commandable = False
                    changed = True
                if changed:
                    exposure.revision += 1
                    exposure.updated_at = now
    elif state == "prune_blocked" or cleanup_status == "blocked":
        workspace.cleanup_state = CloudWorkspaceCleanupState.blocked.value
        workspace.cleanup_last_error = cleanup_error
        workspace.status_detail = "Archive cleanup blocked"
        workspace.updated_at = now
    elif state == "prune_failed" or cleanup_status == "failed":
        workspace.cleanup_state = CloudWorkspaceCleanupState.failed.value
        workspace.cleanup_last_error = cleanup_error or "Worktree cleanup failed."
        workspace.status_detail = "Archive cleanup failed"
        workspace.updated_at = now
    else:
        _mark_command_rejected(
            row,
            code="invalid_prune_workspace_result",
            message="prune_workspace_worktree result has an unsupported materialization state.",
            now=now,
        )
    await db.flush()


def _mark_command_rejected(
    row: CloudCommand,
    *,
    code: str,
    message: str,
    now: datetime,
) -> None:
    row.status = CloudCommandStatus.rejected.value
    row.error_code = code
    row.error_message = message
    row.accepted_at = None
    row.rejected_at = now
    row.updated_at = now


def _result_dict(result_json: str | None) -> dict[str, object] | None:
    try:
        result = json.loads(result_json or "{}")
    except ValueError:
        return None
    return result if isinstance(result, dict) else None


def _result_string(result: dict[str, object], key: str) -> str | None:
    value = result.get(key)
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


def _result_body_workspace_id(result: dict[str, object]) -> str | None:
    body = result.get("body")
    if not isinstance(body, dict):
        return None
    workspace = body.get("workspace")
    if not isinstance(workspace, dict):
        return None
    value = workspace.get("id")
    return value.strip() if isinstance(value, str) and value.strip() else None


def _prune_cleanup_error(result: dict[str, object]) -> str | None:
    message = _result_string(result, "cleanupLastError")
    if message is not None:
        return message[:2000]
    blockers = result.get("blockers")
    if isinstance(blockers, list) and blockers:
        return json.dumps({"blockers": blockers}, separators=(",", ":"), sort_keys=True)[:2000]
    return None


async def _record_started_cloud_session_projection(
    db: AsyncSession,
    *,
    row: CloudCommand,
    result_json: str | None,
    now: datetime,
) -> None:
    if row.cloud_workspace_id is None or not row.workspace_id:
        return
    session_id = _started_session_id(result_json)
    if session_id is None:
        return
    exposure = await load_active_workspace_exposure(
        db,
        target_id=row.target_id,
        cloud_workspace_id=row.cloud_workspace_id,
    )
    if exposure is None or exposure.status != "active" or not exposure.anyharness_workspace_id:
        return
    source_agent_kind = _start_session_agent_kind(row.payload_json)
    projection = (
        await db.execute(
            select(CloudSessionProjection)
            .where(CloudSessionProjection.target_id == row.target_id)
            .where(CloudSessionProjection.session_id == session_id)
            .with_for_update()
            .limit(1)
        )
    ).scalar_one_or_none()
    if projection is None:
        projection = CloudSessionProjection(
            target_id=row.target_id,
            exposure_id=exposure.id if exposure is not None else None,
            cloud_workspace_id=row.cloud_workspace_id,
            workspace_id=row.workspace_id,
            session_id=session_id,
            source_agent_kind=source_agent_kind,
            status="running",
            projection_level=(
                exposure.default_projection_level if exposure is not None else "live"
            ),
            commandable=exposure.commandable if exposure is not None else True,
            last_event_seq=0,
            last_uploaded_seq=0,
            created_at=now,
            updated_at=now,
        )
        db.add(projection)
    else:
        projection.exposure_id = exposure.id if exposure is not None else projection.exposure_id
        projection.cloud_workspace_id = row.cloud_workspace_id
        projection.workspace_id = row.workspace_id
        projection.source_agent_kind = source_agent_kind or projection.source_agent_kind
        projection.status = projection.status or "running"
        if exposure is not None:
            projection.projection_level = exposure.default_projection_level
            projection.commandable = exposure.commandable
        projection.updated_at = now
    await db.flush()


def _start_session_agent_kind(payload_json: str | None) -> str | None:
    try:
        payload = json.loads(payload_json or "{}")
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    value = payload.get("agentKind")
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized if normalized in SUPPORTED_CLOUD_AGENTS else None


def _materialized_workspace_id(
    *,
    kind: str,
    status: str,
    result_json: str | None,
) -> str | None:
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
    if not isinstance(workspace_id, str) or not workspace_id.strip():
        return None
    return workspace_id.strip()


def _result_cloud_workspace_id(result_json: str | None) -> UUID | None:
    try:
        result = json.loads(result_json or "{}")
    except ValueError:
        return None
    if not isinstance(result, dict):
        return None
    value = result.get("cloudWorkspaceId")
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return UUID(value)
    except ValueError:
        return None


def _started_session_id(result_json: str | None) -> str | None:
    try:
        result = json.loads(result_json or "{}")
    except ValueError:
        return None
    if not isinstance(result, dict):
        return None
    candidates: list[object] = [
        result.get("sessionId"),
        result.get("anyharnessSessionId"),
    ]
    body = result.get("body")
    if isinstance(body, dict):
        candidates.extend(
            [
                body.get("sessionId"),
                body.get("id"),
            ]
        )
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def _safe_result_json(*, kind: str, result_json: str | None) -> str | None:
    if kind != CloudCommandKind.refresh_agent_auth_config.value:
        return result_json
    try:
        result = json.loads(result_json or "{}")
    except ValueError:
        return None
    if not isinstance(result, dict):
        return None
    safe: dict[str, object] = {}
    if isinstance(result.get("applied"), bool):
        safe["applied"] = result["applied"]
    if isinstance(result.get("reason"), str):
        safe["reason"] = str(result["reason"])[:128]
    if isinstance(result.get("currentRevision"), int) and not isinstance(
        result.get("currentRevision"),
        bool,
    ):
        safe["currentRevision"] = result["currentRevision"]
    return json.dumps(safe, separators=(",", ":"), sort_keys=True) if safe else None


async def _get_worker_leased_command(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    lease_id: str,
) -> CloudCommand | None:
    return (
        await db.execute(
            select(CloudCommand)
            .where(CloudCommand.id == command_id)
            .where(CloudCommand.leased_by_worker_id == worker_id)
            .where(CloudCommand.lease_id == lease_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
