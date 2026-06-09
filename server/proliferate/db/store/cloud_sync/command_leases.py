"""Cloud command leasing persistence."""

from __future__ import annotations

import json
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudCommandKind, CloudCommandStatus, CloudWorkspaceStatus
from proliferate.db.models.cloud.agent_auth import SandboxProfile, SandboxProfileTargetState
from proliferate.db.models.cloud.commands import CloudCommand
from proliferate.db.models.cloud.runtime_config import (
    SandboxProfileRuntimeConfigCurrent,
    SandboxProfileRuntimeConfigRevision,
)
from proliferate.db.models.cloud.targets import CloudTarget, CloudWorker
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_sync.command_records import (
    CloudCommandSnapshot,
    snapshot_command,
)
from proliferate.db.store.cloud_sync.command_scope import (
    command_allows_cloud_workspace_scope,
    command_requires_managed_workspace,
    command_requires_managed_workspace_for_target,
    load_active_workspace_exposure,
    workspace_matches_command_target,
)

WORKSPACE_LIFECYCLE_GUARDED_COMMAND_KINDS: frozenset[str] = frozenset(
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
        CloudCommandKind.prune_workspace_worktree.value,
    )
)


async def lease_next_command(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID,
    supported_kinds: tuple[str, ...],
    lease_id: str,
    lease_expires_at: datetime,
    now: datetime,
    blocked_commands: list[CloudCommandSnapshot] | None = None,
) -> CloudCommandSnapshot | None:
    worker = await db.get(CloudWorker, worker_id)
    if worker is None or worker.target_id != target_id:
        return None
    target = await db.get(CloudTarget, target_id)
    if target is None or target.archived_at is not None:
        return None
    for _ in range(20):
        query = (
            select(CloudCommand)
            .where(CloudCommand.target_id == target_id)
            .where(CloudCommand.kind.in_(supported_kinds))
            .where(
                or_(
                    CloudCommand.status == CloudCommandStatus.queued.value,
                    and_(
                        CloudCommand.status == CloudCommandStatus.leased.value,
                        CloudCommand.lease_expires_at.is_not(None),
                        CloudCommand.lease_expires_at <= now,
                    ),
                )
            )
        )
        if CloudCommandKind.refresh_agent_auth_config.value not in supported_kinds:
            query = query.where(
                ~and_(
                    CloudCommand.kind.in_(
                        (
                            CloudCommandKind.start_session.value,
                            CloudCommandKind.send_prompt.value,
                        )
                    ),
                    or_(
                        CloudCommand.payload_json.contains('"sandboxProfileId"'),
                        CloudCommand.payload_json.contains('"requiredAgentAuthRevision"'),
                    ),
                )
            )
        row = (
            await db.execute(
                query.order_by(CloudCommand.created_at.asc())
                .with_for_update(skip_locked=True)
                .limit(1)
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        if (
            command_requires_managed_workspace_for_target(
                kind=row.kind,
                payload_json=row.payload_json,
                target=target,
            )
            and row.cloud_workspace_id is None
        ):
            row.status = CloudCommandStatus.rejected.value
            row.error_code = "cloud_workspace_required"
            row.error_message = "Managed materialize_workspace command is missing Cloud workspace."
            row.rejected_at = now
            row.updated_at = now
            await db.flush()
            if blocked_commands is not None:
                blocked_commands.append(snapshot_command(row))
            continue
        if row.cloud_workspace_id is not None and not command_allows_cloud_workspace_scope(
            kind=row.kind,
            payload_json=row.payload_json,
        ):
            row.status = CloudCommandStatus.rejected.value
            row.error_code = "cloud_workspace_not_allowed"
            row.error_message = (
                "existing_path materialize_workspace commands cannot scope a Cloud workspace."
            )
            row.rejected_at = now
            row.updated_at = now
            await db.flush()
            if blocked_commands is not None:
                blocked_commands.append(snapshot_command(row))
            continue
        lifecycle_error = await _workspace_lifecycle_lease_blocker(db, row)
        if lifecycle_error is not None:
            status, code, message = lifecycle_error
            row.status = status
            row.error_code = code
            row.error_message = message
            if status == CloudCommandStatus.rejected.value:
                row.rejected_at = now
            row.updated_at = now
            await db.flush()
            if blocked_commands is not None:
                blocked_commands.append(snapshot_command(row))
            continue
        exposure_error = await _exposure_lease_blocker(db, row)
        if exposure_error is not None:
            status, code, message = exposure_error
            row.status = status
            row.error_code = code
            row.error_message = message
            if status == CloudCommandStatus.rejected.value:
                row.rejected_at = now
            row.updated_at = now
            await db.flush()
            if blocked_commands is not None:
                blocked_commands.append(snapshot_command(row))
            continue
        runtime_config_error = await _runtime_config_lease_blocker(db, row, target=target)
        if runtime_config_error is not None:
            status, code, message = runtime_config_error
            row.status = status
            row.error_code = code
            row.error_message = message
            if status == CloudCommandStatus.rejected.value:
                row.rejected_at = now
            row.updated_at = now
            await db.flush()
            if blocked_commands is not None:
                blocked_commands.append(snapshot_command(row))
            continue
        agent_auth_error = await _agent_auth_lease_blocker(db, row, target=target)
        if agent_auth_error is not None:
            status, code, message = agent_auth_error
            row.status = status
            row.error_code = code
            row.error_message = message
            if status == CloudCommandStatus.rejected.value:
                row.rejected_at = now
            row.updated_at = now
            await db.flush()
            if blocked_commands is not None:
                blocked_commands.append(snapshot_command(row))
            continue
        row.status = CloudCommandStatus.leased.value
        row.lease_id = lease_id
        row.leased_by_worker_id = worker_id
        row.lease_expires_at = lease_expires_at
        row.attempt_count += 1
        row.delivered_at = None
        row.error_code = None
        row.error_message = None
        row.updated_at = now
        await db.flush()
        return snapshot_command(row)
    return None


async def _workspace_lifecycle_lease_blocker(
    db: AsyncSession,
    row: CloudCommand,
) -> tuple[str, str, str] | None:
    if row.cloud_workspace_id is None or row.kind not in WORKSPACE_LIFECYCLE_GUARDED_COMMAND_KINDS:
        return None
    workspace = await db.get(CloudWorkspace, row.cloud_workspace_id)
    if workspace is None:
        return (
            CloudCommandStatus.superseded.value,
            "cloud_workspace_missing",
            "Workspace command was superseded because the Cloud workspace no longer exists.",
        )
    if not await workspace_matches_command_target(db, workspace=workspace, row=row):
        return (
            CloudCommandStatus.superseded.value,
            "cloud_workspace_target_mismatch",
            "Workspace command target no longer matches the Cloud workspace.",
        )
    if (
        workspace.archived_at is not None
        and row.kind != CloudCommandKind.prune_workspace_worktree.value
    ):
        return (
            CloudCommandStatus.superseded.value,
            "cloud_workspace_archived",
            "Workspace command was superseded because the Cloud workspace is archived.",
        )
    return None


async def _runtime_config_lease_blocker(
    db: AsyncSession,
    row: CloudCommand,
    *,
    target: CloudTarget | None,
) -> tuple[str, str, str] | None:
    if row.kind not in {
        CloudCommandKind.start_session.value,
        CloudCommandKind.send_prompt.value,
        CloudCommandKind.decide_plan.value,
    }:
        return None
    try:
        payload = json.loads(row.payload_json or "{}")
    except json.JSONDecodeError:
        return (
            CloudCommandStatus.rejected.value,
            "runtime_config_payload_invalid",
            "Launch command payload is not valid JSON.",
        )
    if not isinstance(payload, dict):
        return (
            CloudCommandStatus.rejected.value,
            "runtime_config_payload_invalid",
            "Launch command payload is invalid.",
        )
    sandbox_profile_id = payload.get("sandboxProfileId")
    required_revision_id = payload.get("requiredRuntimeConfigRevisionId")
    required_sequence = payload.get("requiredRuntimeConfigSequence")
    required_content_hash = payload.get("requiredRuntimeConfigContentHash")
    if (
        required_revision_id is None
        and required_sequence is None
        and required_content_hash is None
    ):
        return None
    try:
        profile_id = UUID(str(sandbox_profile_id))
    except (TypeError, ValueError):
        return (
            CloudCommandStatus.rejected.value,
            "runtime_config_profile_invalid",
            "Launch command runtime config profile is invalid.",
        )
    try:
        revision_id = UUID(str(required_revision_id))
    except (TypeError, ValueError):
        return (
            CloudCommandStatus.rejected.value,
            "runtime_config_revision_invalid",
            "Launch command runtime config revision is invalid.",
        )
    if not isinstance(required_sequence, int) or isinstance(required_sequence, bool):
        return (
            CloudCommandStatus.rejected.value,
            "runtime_config_sequence_invalid",
            "Launch command runtime config sequence is invalid.",
        )
    if not isinstance(required_content_hash, str) or not required_content_hash.strip():
        return (
            CloudCommandStatus.rejected.value,
            "runtime_config_hash_invalid",
            "Launch command runtime config content hash is invalid.",
        )
    if target is None or target.sandbox_profile_id != profile_id:
        return (
            CloudCommandStatus.superseded.value,
            "runtime_config_target_mismatch",
            "Launch command runtime config target no longer matches.",
        )
    current = await db.get(SandboxProfileRuntimeConfigCurrent, profile_id)
    if current is None or current.current_revision_id != revision_id:
        return (
            CloudCommandStatus.superseded.value,
            "runtime_config_revision_stale",
            "Launch command runtime config revision was superseded before dispatch.",
        )
    revision = await db.get(SandboxProfileRuntimeConfigRevision, revision_id)
    if (
        revision is None
        or revision.sandbox_profile_id != profile_id
        or revision.sequence != required_sequence
        or revision.content_hash != required_content_hash
    ):
        return (
            CloudCommandStatus.superseded.value,
            "runtime_config_revision_stale",
            "Launch command runtime config revision was superseded before dispatch.",
        )
    if _runtime_config_has_blocking_errors(revision.manifest_json):
        return (
            CloudCommandStatus.superseded.value,
            "runtime_config_blocked",
            "Launch command runtime config is blocked by resolver errors.",
        )
    state = (
        await db.execute(
            select(SandboxProfileTargetState).where(
                SandboxProfileTargetState.sandbox_profile_id == profile_id,
                SandboxProfileTargetState.target_id == row.target_id,
            )
        )
    ).scalar_one_or_none()
    if (
        state is None
        or state.runtime_config_status != "applied"
        or state.applied_runtime_config_revision_id != str(revision_id)
        or state.applied_runtime_config_sequence < required_sequence
    ):
        return (
            CloudCommandStatus.superseded.value,
            "runtime_config_not_ready",
            "Launch command runtime config was no longer current before dispatch.",
        )
    return None


async def _exposure_lease_blocker(
    db: AsyncSession,
    row: CloudCommand,
) -> tuple[str, str, str] | None:
    if row.kind not in {
        CloudCommandKind.backfill_exposed_workspace.value,
        CloudCommandKind.materialize_workspace.value,
    }:
        return None
    if (
        row.kind == CloudCommandKind.materialize_workspace.value
        and not await command_requires_managed_workspace(
            db,
            row,
        )
    ):
        return None
    if row.cloud_workspace_id is None:
        return (
            CloudCommandStatus.rejected.value,
            "cloud_workspace_required",
            f"{row.kind} command is missing Cloud workspace.",
        )
    exposure = await load_active_workspace_exposure(
        db,
        target_id=row.target_id,
        cloud_workspace_id=row.cloud_workspace_id,
    )
    if exposure is None or exposure.status != "active":
        return (
            CloudCommandStatus.rejected.value,
            "cloud_exposure_not_active",
            f"{row.kind} command does not reference an active exposure.",
        )
    if row.kind == CloudCommandKind.materialize_workspace.value:
        workspace = await db.get(CloudWorkspace, row.cloud_workspace_id)
        can_rematerialize_pruned_workspace = (
            workspace is not None
            and workspace.archived_at is None
            and workspace.anyharness_workspace_id is None
            and workspace.status == CloudWorkspaceStatus.needs_rematerialization.value
        )
        if not exposure.commandable and not can_rematerialize_pruned_workspace:
            return (
                CloudCommandStatus.rejected.value,
                "cloud_exposure_not_commandable",
                "materialize_workspace exposure is read-only.",
            )
        return None
    if not exposure.anyharness_workspace_id or (
        row.workspace_id is not None and row.workspace_id != exposure.anyharness_workspace_id
    ):
        return (
            CloudCommandStatus.rejected.value,
            "cloud_exposure_not_active",
            "backfill_exposed_workspace command does not reference an active exposure.",
        )
    return None


def _runtime_config_has_blocking_errors(manifest_json: str) -> bool:
    try:
        manifest = json.loads(manifest_json)
    except ValueError:
        return False
    if not isinstance(manifest, dict):
        return False
    blocking_errors = manifest.get("blockingErrors")
    return isinstance(blocking_errors, list) and any(
        isinstance(item, dict) for item in blocking_errors
    )


async def _agent_auth_lease_blocker(
    db: AsyncSession,
    row: CloudCommand,
    *,
    target: CloudTarget | None,
) -> tuple[str, str, str] | None:
    if row.kind not in {
        CloudCommandKind.start_session.value,
        CloudCommandKind.send_prompt.value,
    }:
        return None
    try:
        payload = json.loads(row.payload_json or "{}")
    except json.JSONDecodeError:
        return (
            CloudCommandStatus.rejected.value,
            "agent_auth_payload_invalid",
            "Launch command payload is not valid JSON.",
        )
    if not isinstance(payload, dict):
        return (
            CloudCommandStatus.rejected.value,
            "agent_auth_payload_invalid",
            "Launch command payload is invalid.",
        )
    sandbox_profile_id = payload.get("sandboxProfileId")
    required_revision = payload.get("requiredAgentAuthRevision")
    if sandbox_profile_id is None and required_revision is None:
        return None
    try:
        profile_id = UUID(str(sandbox_profile_id))
    except (TypeError, ValueError):
        return (
            CloudCommandStatus.rejected.value,
            "agent_auth_profile_invalid",
            "Launch command agent auth profile is invalid.",
        )
    if not isinstance(required_revision, int) or isinstance(required_revision, bool):
        return (
            CloudCommandStatus.rejected.value,
            "agent_auth_revision_invalid",
            "Launch command agent auth revision is invalid.",
        )
    if target is None or target.sandbox_profile_id != profile_id:
        return (
            CloudCommandStatus.superseded.value,
            "agent_auth_target_mismatch",
            "Launch command agent auth target no longer matches.",
        )
    profile = await db.get(SandboxProfile, profile_id)
    if profile is None or profile.archived_at is not None or profile.deleted_at is not None:
        return (
            CloudCommandStatus.superseded.value,
            "agent_auth_profile_missing",
            "Launch command agent auth profile is no longer available.",
        )
    if required_revision != profile.desired_agent_auth_revision:
        return (
            CloudCommandStatus.superseded.value,
            "agent_auth_revision_stale",
            "Launch command agent auth revision was superseded before dispatch.",
        )
    state = (
        await db.execute(
            select(SandboxProfileTargetState).where(
                SandboxProfileTargetState.sandbox_profile_id == profile_id,
                SandboxProfileTargetState.target_id == row.target_id,
            )
        )
    ).scalar_one_or_none()
    if (
        state is None
        or state.agent_auth_status != "applied"
        or state.applied_agent_auth_revision is None
        or state.applied_agent_auth_revision < required_revision
    ):
        return (
            CloudCommandStatus.superseded.value,
            "agent_auth_not_ready",
            "Launch command agent auth config was no longer current before dispatch.",
        )
    if state.agent_auth_force_restart_required:
        return (
            CloudCommandStatus.superseded.value,
            "agent_auth_restart_required",
            "Launch command agent auth config requires restart before dispatch.",
        )
    return None
