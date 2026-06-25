"""Cloud agent-auth target states store operations."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_auth_profiles import (
    SandboxProfileTargetState,
)
from proliferate.db.store.cloud_agent_auth.mappers import (
    _target_state_record,
)
from proliferate.db.store.cloud_agent_auth.records import (
    SandboxProfileAgentAuthTargetStateRecord,
)
from proliferate.utils.time import utcnow

_UNSET = object()


async def list_target_states_for_profile(
    db: AsyncSession,
    sandbox_profile_id: UUID,
) -> tuple[SandboxProfileAgentAuthTargetStateRecord, ...]:
    rows = (
        (
            await db.execute(
                select(SandboxProfileTargetState)
                .where(SandboxProfileTargetState.sandbox_profile_id == sandbox_profile_id)
                .order_by(SandboxProfileTargetState.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_target_state_record(row) for row in rows)


async def get_target_state(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
) -> SandboxProfileAgentAuthTargetStateRecord | None:
    row = (
        await db.execute(
            select(SandboxProfileTargetState).where(
                SandboxProfileTargetState.sandbox_profile_id == sandbox_profile_id,
                SandboxProfileTargetState.target_id == target_id,
            )
        )
    ).scalar_one_or_none()
    return _target_state_record(row) if row is not None else None


async def upsert_target_state(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    desired_revision: int,
    applied_revision: int | None,
    status: str,
    force_restart_required: bool,
    last_command_id: UUID | None,
    last_worker_id: UUID | None,
    last_error_code: str | None,
    last_error_message: str | None,
    pending_cleanup_json: str | None | object = _UNSET,
) -> SandboxProfileAgentAuthTargetStateRecord:
    row = (
        await db.execute(
            select(SandboxProfileTargetState)
            .where(
                SandboxProfileTargetState.sandbox_profile_id == sandbox_profile_id,
                SandboxProfileTargetState.target_id == target_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    attempted_at = now if status in {"materializing", "failed", "applied"} else None
    applied_at = now if status == "applied" else None
    if row is None:
        row = SandboxProfileTargetState(
            sandbox_profile_id=sandbox_profile_id,
            target_id=target_id,
            desired_agent_auth_revision=desired_revision,
            applied_agent_auth_revision=applied_revision,
            agent_auth_status=status,
            agent_auth_force_restart_required=force_restart_required,
            last_agent_auth_command_id=last_command_id,
            last_agent_auth_worker_id=last_worker_id,
            last_agent_auth_attempted_at=attempted_at,
            last_agent_auth_applied_at=applied_at,
            last_agent_auth_error_code=last_error_code,
            last_agent_auth_error_message=last_error_message,
            pending_agent_auth_cleanup_json=(
                None if pending_cleanup_json is _UNSET else pending_cleanup_json
            ),
            applied_runtime_config_sequence=0,
            applied_runtime_config_revision_id=None,
            runtime_config_status="applied",
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        row.desired_agent_auth_revision = desired_revision
        row.applied_agent_auth_revision = applied_revision
        row.agent_auth_status = status
        row.agent_auth_force_restart_required = force_restart_required
        row.last_agent_auth_command_id = last_command_id
        row.last_agent_auth_worker_id = last_worker_id
        if attempted_at is not None:
            row.last_agent_auth_attempted_at = attempted_at
        if applied_at is not None:
            row.last_agent_auth_applied_at = applied_at
        row.last_agent_auth_error_code = last_error_code
        row.last_agent_auth_error_message = last_error_message
        if pending_cleanup_json is not _UNSET:
            row.pending_agent_auth_cleanup_json = pending_cleanup_json
        elif status == "applied":
            row.pending_agent_auth_cleanup_json = None
        row.updated_at = now
    await db.flush()
    return _target_state_record(row)


async def mark_runtime_config_pending(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    sequence: int,
    revision_id: UUID,
) -> SandboxProfileAgentAuthTargetStateRecord:
    row = await _get_or_create_target_state_for_update(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        runtime_config_status="pending",
    )
    if (
        row.applied_runtime_config_revision_id != str(revision_id)
        or row.applied_runtime_config_sequence < sequence
    ):
        row.runtime_config_status = "pending"
        row.updated_at = utcnow()
    await db.flush()
    return _target_state_record(row)


async def mark_runtime_config_failed(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    sequence: int,
    revision_id: UUID,
    error_code: str,
    error_message: str,
) -> SandboxProfileAgentAuthTargetStateRecord:
    row = await _get_or_create_target_state_for_update(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        runtime_config_status="failed",
    )
    row.runtime_config_status = "failed"
    row.last_runtime_config_attempted_at = utcnow()
    row.last_runtime_config_error_code = error_code
    row.last_runtime_config_error_message = error_message
    if (
        row.applied_runtime_config_revision_id == str(revision_id)
        and row.applied_runtime_config_sequence >= sequence
    ):
        row.applied_runtime_config_sequence = 0
        row.applied_runtime_config_revision_id = None
    row.updated_at = utcnow()
    await db.flush()
    return _target_state_record(row)


async def record_runtime_config_command(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    command_id: UUID,
) -> SandboxProfileAgentAuthTargetStateRecord | None:
    row = await _load_target_state_for_update(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
    )
    if row is None:
        return None
    row.last_runtime_config_command_id = command_id
    row.runtime_config_status = "pending"
    row.updated_at = utcnow()
    await db.flush()
    return _target_state_record(row)


async def record_runtime_config_worker_status(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    sequence: int,
    revision_id: UUID,
    worker_id: UUID | None,
    status: str,
    error_code: str | None,
    error_message: str | None,
) -> SandboxProfileAgentAuthTargetStateRecord:
    row = await _get_or_create_target_state_for_update(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        runtime_config_status=status,
    )
    now = utcnow()
    row.runtime_config_status = status
    row.last_runtime_config_worker_id = worker_id
    row.last_runtime_config_attempted_at = now
    row.last_runtime_config_error_code = error_code
    row.last_runtime_config_error_message = error_message
    if status == "applied":
        row.applied_runtime_config_sequence = sequence
        row.applied_runtime_config_revision_id = str(revision_id)
        row.last_runtime_config_applied_at = now
        row.last_runtime_config_error_code = None
        row.last_runtime_config_error_message = None
    row.updated_at = now
    await db.flush()
    return _target_state_record(row)


async def record_runtime_config_direct_status(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    sequence: int,
    revision_id: UUID,
    status: str,
    error_code: str | None,
    error_message: str | None,
) -> SandboxProfileAgentAuthTargetStateRecord:
    return await record_runtime_config_worker_status(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        sequence=sequence,
        revision_id=revision_id,
        worker_id=None,
        status=status,
        error_code=error_code,
        error_message=error_message,
    )


async def _load_target_state_for_update(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
) -> SandboxProfileTargetState | None:
    return (
        await db.execute(
            select(SandboxProfileTargetState)
            .where(
                SandboxProfileTargetState.sandbox_profile_id == sandbox_profile_id,
                SandboxProfileTargetState.target_id == target_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()


async def _get_or_create_target_state_for_update(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    runtime_config_status: str,
) -> SandboxProfileTargetState:
    row = await _load_target_state_for_update(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
    )
    if row is not None:
        return row
    now = utcnow()
    row = SandboxProfileTargetState(
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        desired_agent_auth_revision=0,
        applied_agent_auth_revision=None,
        agent_auth_status="applied",
        agent_auth_force_restart_required=False,
        applied_runtime_config_sequence=0,
        applied_runtime_config_revision_id=None,
        runtime_config_status=runtime_config_status,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    return row
