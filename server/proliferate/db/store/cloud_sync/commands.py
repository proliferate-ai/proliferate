"""Cloud command persistence."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudCommandKind, CloudCommandStatus
from proliferate.db.models.cloud.agent_auth import SandboxProfile, SandboxProfileTargetState
from proliferate.db.models.cloud.commands import CloudCommand
from proliferate.db.models.cloud.exposures import CloudWorkspaceExposure
from proliferate.db.models.cloud.runtime_config import (
    SandboxProfileRuntimeConfigCurrent,
    SandboxProfileRuntimeConfigRevision,
)
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.sync import CloudSessionProjection
from proliferate.db.models.cloud.targets import CloudTarget, CloudWorker
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_profile_target_guard import managed_profile_target_requires_slot
from proliferate.utils.time import utcnow

ACTIVE_SLOT_STATUSES: tuple[str, ...] = ("creating", "running", "paused", "blocked")


@dataclass(frozen=True)
class CloudCommandSnapshot:
    id: UUID
    idempotency_scope: str
    idempotency_key: str
    target_id: UUID
    organization_id: UUID | None
    actor_user_id: UUID | None
    actor_kind: str
    source: str
    workspace_id: str | None
    cloud_workspace_id: UUID | None
    session_id: str | None
    kind: str
    payload_json: str
    observed_event_seq: int | None
    preconditions_json: str | None
    authorization_context_json: str | None
    status: str
    lease_id: str | None
    leased_by_worker_id: UUID | None
    leased_cloud_sandbox_id: UUID | None
    leased_slot_generation: int | None
    attempt_count: int
    lease_expires_at: datetime | None
    delivered_at: datetime | None
    accepted_at: datetime | None
    rejected_at: datetime | None
    expired_at: datetime | None
    error_code: str | None
    error_message: str | None
    result_json: str | None
    created_at: datetime
    updated_at: datetime


def _snapshot(row: CloudCommand) -> CloudCommandSnapshot:
    return CloudCommandSnapshot(
        id=row.id,
        idempotency_scope=row.idempotency_scope,
        idempotency_key=row.idempotency_key,
        target_id=row.target_id,
        organization_id=row.organization_id,
        actor_user_id=row.actor_user_id,
        actor_kind=row.actor_kind,
        source=row.source,
        workspace_id=row.workspace_id,
        cloud_workspace_id=row.cloud_workspace_id,
        session_id=row.session_id,
        kind=row.kind,
        payload_json=row.payload_json,
        observed_event_seq=row.observed_event_seq,
        preconditions_json=row.preconditions_json,
        authorization_context_json=row.authorization_context_json,
        status=row.status,
        lease_id=row.lease_id,
        leased_by_worker_id=row.leased_by_worker_id,
        leased_cloud_sandbox_id=row.leased_cloud_sandbox_id,
        leased_slot_generation=row.leased_slot_generation,
        attempt_count=row.attempt_count,
        lease_expires_at=row.lease_expires_at,
        delivered_at=row.delivered_at,
        accepted_at=row.accepted_at,
        rejected_at=row.rejected_at,
        expired_at=row.expired_at,
        error_code=row.error_code,
        error_message=row.error_message,
        result_json=row.result_json,
        created_at=row.created_at,
        updated_at=row.updated_at,
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
        and _target_requires_slot(target)
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
    return _snapshot(row)


async def get_command_by_id(
    db: AsyncSession,
    command_id: UUID,
) -> CloudCommandSnapshot | None:
    row = await db.get(CloudCommand, command_id)
    return _snapshot(row) if row is not None else None


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
    return _snapshot(row) if row is not None else None


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
    if _is_terminal_status(row.status):
        return _snapshot(row)
    if eligible_statuses is not None and row.status not in eligible_statuses:
        return _snapshot(row)
    row.status = CloudCommandStatus.expired.value
    row.expired_at = now
    row.error_code = error_code
    row.error_message = error_message
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


async def lease_next_command(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID,
    supported_kinds: tuple[str, ...],
    lease_id: str,
    lease_expires_at: datetime,
    now: datetime,
) -> CloudCommandSnapshot | None:
    worker = await db.get(CloudWorker, worker_id)
    if worker is None:
        return None
    target = await db.get(CloudTarget, target_id)
    target_requires_slot = _target_requires_slot(target)
    if target_requires_slot and (
        worker.cloud_sandbox_id is None or worker.slot_generation is None
    ):
        return None
    if worker.cloud_sandbox_id is not None or target_requires_slot:
        if worker.cloud_sandbox_id is None or worker.slot_generation is None:
            return None
        active_slot = (
            await db.execute(
                select(CloudSandbox.id).where(
                    CloudSandbox.id == worker.cloud_sandbox_id,
                    CloudSandbox.target_id == target_id,
                    CloudSandbox.slot_generation == worker.slot_generation,
                    CloudSandbox.superseded_at.is_(None),
                    CloudSandbox.status.in_(ACTIVE_SLOT_STATUSES),
                )
            )
        ).scalar_one_or_none()
        if active_slot is None:
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
            row.kind == CloudCommandKind.materialize_workspace.value
            and target_requires_slot
            and row.cloud_workspace_id is None
        ):
            row.status = CloudCommandStatus.rejected.value
            row.error_code = "cloud_workspace_required"
            row.error_message = "Managed materialize_workspace command is missing Cloud workspace."
            row.rejected_at = now
            row.updated_at = now
            await db.flush()
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
            continue
        row.status = CloudCommandStatus.leased.value
        row.lease_id = lease_id
        row.leased_by_worker_id = worker_id
        row.leased_cloud_sandbox_id = worker.cloud_sandbox_id
        row.leased_slot_generation = worker.slot_generation
        row.lease_expires_at = lease_expires_at
        row.attempt_count += 1
        row.delivered_at = None
        row.error_code = None
        row.error_message = None
        row.updated_at = now
        await db.flush()
        return _snapshot(row)
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
        sandbox_profile_id is None
        and required_revision_id is None
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
        or await _target_state_slot_is_stale(db, state=state, target=target)
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
        and not await _command_requires_slot(
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
    exposure = await _load_active_workspace_exposure(
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
        if not exposure.commandable:
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
        or await _target_state_slot_is_stale(db, state=state, target=target)
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


async def mark_command_delivered(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    lease_id: str,
    slot_generation: int | None,
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
        return _snapshot(row)
    if _is_terminal_status(row.status) or row.status != CloudCommandStatus.leased.value:
        return None
    if await _leased_slot_is_stale(db, row, worker_id=worker_id):
        row.status = CloudCommandStatus.superseded.value
        row.error_code = "stale_slot"
        row.error_message = "Command delivery came from a stale sandbox slot."
        row.updated_at = now
        await db.flush()
        return _snapshot(row)
    if await _leased_slot_echo_is_stale(db, row, slot_generation=slot_generation):
        row.status = CloudCommandStatus.superseded.value
        row.error_code = "stale_slot"
        row.error_message = "Command delivery did not echo the leased sandbox slot generation."
        row.updated_at = now
        await db.flush()
        return _snapshot(row)
    row.status = CloudCommandStatus.delivered.value
    row.delivered_at = now
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


async def mark_command_failed_delivery(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    lease_id: str,
    slot_generation: int | None,
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
    if _is_terminal_status(row.status):
        return _snapshot(row)
    if row.status not in {
        CloudCommandStatus.leased.value,
        CloudCommandStatus.delivered.value,
    }:
        return None
    if await _leased_slot_is_stale(db, row, worker_id=worker_id):
        row.status = CloudCommandStatus.superseded.value
        row.error_code = "stale_slot"
        row.error_message = "Command delivery came from a stale sandbox slot."
        row.updated_at = now
        await db.flush()
        return _snapshot(row)
    if await _leased_slot_echo_is_stale(db, row, slot_generation=slot_generation):
        row.status = CloudCommandStatus.superseded.value
        row.error_code = "stale_slot"
        row.error_message = "Command delivery did not echo the leased sandbox slot generation."
        row.updated_at = now
        await db.flush()
        return _snapshot(row)
    row.status = CloudCommandStatus.failed_delivery.value
    row.error_code = error_code
    row.error_message = error_message
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


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
    return tuple(_snapshot(row) for row in rows)


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
    slot_generation: int | None,
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
    if _is_terminal_status(row.status):
        return _snapshot(row)
    if row.status not in {
        CloudCommandStatus.leased.value,
        CloudCommandStatus.delivered.value,
    }:
        return None
    stale_slot = await _leased_slot_is_stale(db, row, worker_id=worker_id)
    if stale_slot:
        row.status = CloudCommandStatus.superseded.value
        row.error_code = "stale_slot"
        row.error_message = "Command result came from a stale sandbox slot."
        row.updated_at = now
        await db.flush()
        return _snapshot(row)
    command_requires_slot = await _command_requires_slot(db, row)
    if command_requires_slot and slot_generation != row.leased_slot_generation:
        row.status = CloudCommandStatus.superseded.value
        row.error_code = "stale_slot"
        row.error_message = "Command result did not echo the leased sandbox slot generation."
        row.updated_at = now
        await db.flush()
        return _snapshot(row)
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
        and command_requires_slot
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
            or not await _cloud_workspace_matches_command(db, row)
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
            slot_generation=row.leased_slot_generation,
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
    return _snapshot(row)


async def _leased_slot_is_stale(
    db: AsyncSession,
    row: CloudCommand,
    *,
    worker_id: UUID,
) -> bool:
    command_requires_slot = await _command_requires_slot(db, row)
    if row.leased_cloud_sandbox_id is None or row.leased_slot_generation is None:
        return not (
            not command_requires_slot
            and row.leased_cloud_sandbox_id is None
            and row.leased_slot_generation is None
        )
    worker = await db.get(CloudWorker, worker_id)
    if worker is None:
        return True
    if (
        worker.cloud_sandbox_id != row.leased_cloud_sandbox_id
        or worker.slot_generation != row.leased_slot_generation
    ):
        return True
    active_slot = (
        await db.execute(
            select(CloudSandbox.id).where(
                CloudSandbox.id == row.leased_cloud_sandbox_id,
                CloudSandbox.target_id == row.target_id,
                CloudSandbox.slot_generation == row.leased_slot_generation,
                CloudSandbox.superseded_at.is_(None),
                CloudSandbox.status.in_(ACTIVE_SLOT_STATUSES),
            )
        )
    ).scalar_one_or_none()
    return active_slot is None


async def _leased_slot_echo_is_stale(
    db: AsyncSession,
    row: CloudCommand,
    *,
    slot_generation: int | None,
) -> bool:
    command_requires_slot = await _command_requires_slot(db, row)
    return command_requires_slot and slot_generation != row.leased_slot_generation


async def _target_state_slot_is_stale(
    db: AsyncSession,
    *,
    state: SandboxProfileTargetState,
    target: CloudTarget | None,
) -> bool:
    if not _target_requires_slot(target):
        return False
    if target is None or target.sandbox_profile_id is None:
        return True
    active_slot = (
        await db.execute(
            select(CloudSandbox).where(
                CloudSandbox.sandbox_profile_id == target.sandbox_profile_id,
                CloudSandbox.target_id == target.id,
                CloudSandbox.superseded_at.is_(None),
                CloudSandbox.status.in_(ACTIVE_SLOT_STATUSES),
            )
        )
    ).scalar_one_or_none()
    if active_slot is None:
        return True
    return (
        state.active_sandbox_id != active_slot.id
        or state.slot_generation != active_slot.slot_generation
    )


async def _command_requires_slot(db: AsyncSession, row: CloudCommand) -> bool:
    return _target_requires_slot(await db.get(CloudTarget, row.target_id))


def _target_requires_slot(target: CloudTarget | None) -> bool:
    if target is None:
        return False
    return managed_profile_target_requires_slot(
        kind=target.kind,
        sandbox_profile_id=target.sandbox_profile_id,
        profile_target_role=target.profile_target_role,
    )


async def _cloud_workspace_matches_command(db: AsyncSession, row: CloudCommand) -> bool:
    if row.cloud_workspace_id is None:
        return True
    workspace = await db.get(CloudWorkspace, row.cloud_workspace_id)
    if (
        workspace is None
        or workspace.target_id != row.target_id
        or workspace.archived_at is not None
    ):
        return False
    target = await db.get(CloudTarget, row.target_id)
    if _target_requires_slot(target):
        if workspace.sandbox_profile_id != target.sandbox_profile_id:
            return False
        exposure = await _load_active_workspace_exposure(
            db,
            target_id=row.target_id,
            cloud_workspace_id=workspace.id,
        )
        return exposure is not None and exposure.status == "active" and exposure.commandable
    return True


async def _record_materialized_cloud_workspace(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID,
    anyharness_workspace_id: str,
    slot_generation: int | None,
    now: datetime,
) -> None:
    workspace = await db.get(CloudWorkspace, cloud_workspace_id)
    if workspace is None:
        return
    workspace.anyharness_workspace_id = anyharness_workspace_id
    workspace.materialized_slot_generation = slot_generation
    workspace.status = "ready"
    workspace.status_detail = "Ready"
    workspace.ready_at = now
    workspace.updated_at = now
    if workspace.target_id is not None:
        exposure = await _load_active_workspace_exposure(
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
            if changed:
                exposure.revision += 1
                exposure.updated_at = now
    await db.flush()


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
    exposure = await _load_active_workspace_exposure(
        db,
        target_id=row.target_id,
        cloud_workspace_id=row.cloud_workspace_id,
    )
    if exposure is None or exposure.status != "active" or not exposure.anyharness_workspace_id:
        return
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
        projection.status = projection.status or "running"
        if exposure is not None:
            projection.projection_level = exposure.default_projection_level
            projection.commandable = exposure.commandable
        projection.updated_at = now
    await db.flush()


async def _load_active_workspace_exposure(
    db: AsyncSession,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID,
) -> CloudWorkspaceExposure | None:
    return (
        await db.execute(
            select(CloudWorkspaceExposure)
            .where(CloudWorkspaceExposure.target_id == target_id)
            .where(CloudWorkspaceExposure.cloud_workspace_id == cloud_workspace_id)
            .where(CloudWorkspaceExposure.archived_at.is_(None))
            .limit(1)
        )
    ).scalar_one_or_none()


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


def _is_terminal_status(status: str) -> bool:
    return status in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.expired.value,
        CloudCommandStatus.superseded.value,
        CloudCommandStatus.failed_delivery.value,
    }


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
