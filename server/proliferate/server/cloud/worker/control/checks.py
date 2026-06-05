"""Database-backed worker control checks."""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_control as worker_control_store
from proliferate.db.store.cloud_sync import worker_exposures as worker_exposures_store
from proliferate.server.cloud.commands import service as command_service
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.live.service import publish_command_status_after_commit
from proliferate.server.cloud.worker.domain.rules import (
    clamp_command_lease_seconds,
    normalize_supported_command_kinds,
)
from proliferate.server.cloud.worker.models import (
    WorkerControlWaitRequest,
    WorkerControlWaitResponse,
    WorkerExposureSnapshotResponse,
)
from proliferate.server.cloud.worker.revoked_jti import list_revoked_jtis_for_target
from proliferate.server.cloud.worker.service import (
    _command_envelope,
    authenticate_worker,
)
from proliferate.server.cloud.worker.target_validation import (
    require_current_worker_target as _require_current_worker_target,
)
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class ControlCheck:
    target_id: UUID
    response: WorkerControlWaitResponse | None


async def check_worker_control(
    *,
    body: WorkerControlWaitRequest,
    authorization: str | None,
    timeout_response: bool,
) -> ControlCheck:
    supported_kinds = (
        normalize_supported_command_kinds(body.supported_kinds) if body.lease_commands else ()
    )
    lease_seconds = clamp_command_lease_seconds(body.lease_timeout_seconds)
    cursor = worker_control_store.parse_control_cursor(body.control_cursor)
    async with db_engine.async_session_factory() as db:
        auth = await authenticate_worker(db, authorization=authorization)
        target = await targets_store.get_target_by_id(db, auth.target_id)
        if target is None:
            raise CloudApiError(
                "cloud_worker_target_missing",
                "Worker target no longer exists.",
                status_code=401,
            )
        _require_current_worker_target(target)

        now = utcnow()
        expired_commands = await command_service.expire_stale_client_commands_for_target(
            db,
            target_id=auth.target_id,
        )
        blocked_commands: list[commands_store.CloudCommandSnapshot] = []
        command = (
            await commands_store.lease_next_command(
                db,
                target_id=auth.target_id,
                worker_id=auth.worker_id,
                supported_kinds=supported_kinds,
                lease_id=secrets.token_urlsafe(24),
                lease_expires_at=now + timedelta(seconds=lease_seconds),
                now=now,
                blocked_commands=blocked_commands,
            )
            if body.lease_commands
            else None
        )
        command_scan_changed_state = bool(blocked_commands)
        if command is not None:
            log_cloud_event(
                "cloud worker command leased",
                command_id=command.id,
                target_id=auth.target_id,
                worker_id=auth.worker_id,
                kind=command.kind,
                workspace_id=command.workspace_id,
                session_id=command.session_id,
                cloud_workspace_id=command.cloud_workspace_id,
                attempt_count=command.attempt_count,
                lease_expires_at=command.lease_expires_at,
            )
            await publish_command_status_after_commit(db, command)
        for blocked_command in blocked_commands:
            await publish_command_status_after_commit(db, blocked_command)
        if command_scan_changed_state:
            await worker_control_store.bump_control_revision(
                db,
                target_id=auth.target_id,
                now=now,
            )

        state = await worker_control_store.get_or_create_control_state(
            db,
            target_id=auth.target_id,
        )
        needs_full_snapshot = worker_control_store.cursor_needs_full_snapshot(cursor, state)
        exposures_current = (
            False
            if needs_full_snapshot
            else worker_control_store.cursor_exposures_are_current(cursor, state)
        )
        revoked_jtis_current = (
            state.revoked_jti_revision == 0
            if needs_full_snapshot
            else worker_control_store.cursor_revoked_jtis_are_current(cursor, state)
        )
        include_exposures = not exposures_current
        include_revoked_jtis = not revoked_jtis_current
        exposure_snapshots: tuple[worker_exposures_store.WorkerExposureSnapshot, ...] = ()
        if include_exposures:
            exposure_snapshots = (
                await worker_exposures_store.list_worker_exposure_snapshots_for_target(
                    db,
                    target_id=auth.target_id,
                )
            )
            state = await worker_control_store.ensure_exposure_state_current(
                db,
                target_id=auth.target_id,
                snapshots=exposure_snapshots,
            )
            needs_full_snapshot = worker_control_store.cursor_needs_full_snapshot(cursor, state)
            exposures_current = (
                False
                if needs_full_snapshot
                else worker_control_store.cursor_exposures_are_current(cursor, state)
            )
            revoked_jtis_current = (
                state.revoked_jti_revision == 0
                if needs_full_snapshot
                else worker_control_store.cursor_revoked_jtis_are_current(cursor, state)
            )
            include_exposures = not exposures_current
            include_revoked_jtis = not revoked_jtis_current
        revoked_jtis = (
            await list_revoked_jtis_for_target(
                db,
                target_id=auth.target_id,
                cursor=body.revoked_jti_cursor,
                until=now,
            )
            if include_revoked_jtis
            else None
        )
        control_cursor = worker_control_store.control_cursor_for_state(state)
        state_current = (
            False if needs_full_snapshot else worker_control_store.cursor_is_current(cursor, state)
        )

        response: WorkerControlWaitResponse | None = None
        if command is not None:
            reason = _control_reason(
                command=True,
                exposures=include_exposures,
                revoked_jtis=include_revoked_jtis,
            )
            response = WorkerControlWaitResponse(
                command=_command_envelope(command),
                exposures=(_exposure_responses(exposure_snapshots) if include_exposures else None),
                revoked_jtis=revoked_jtis,
                control_cursor=control_cursor,
                reason=reason,
                server_time=now.isoformat(),
            )
        elif include_exposures:
            response = WorkerControlWaitResponse(
                command=None,
                exposures=_exposure_responses(exposure_snapshots),
                revoked_jtis=revoked_jtis,
                control_cursor=control_cursor,
                reason=_control_reason(
                    command=False,
                    exposures=True,
                    revoked_jtis=include_revoked_jtis,
                ),
                server_time=now.isoformat(),
            )
        elif include_revoked_jtis:
            response = WorkerControlWaitResponse(
                command=None,
                exposures=None,
                revoked_jtis=revoked_jtis,
                control_cursor=control_cursor,
                reason="revoked_jtis",
                server_time=now.isoformat(),
            )
        elif not state_current or expired_commands or command_scan_changed_state:
            response = WorkerControlWaitResponse(
                command=None,
                exposures=None,
                revoked_jtis=None,
                control_cursor=control_cursor,
                reason="state_changed",
                server_time=now.isoformat(),
            )
        elif timeout_response:
            response = WorkerControlWaitResponse(
                command=None,
                exposures=None,
                revoked_jtis=None,
                control_cursor=control_cursor,
                reason="timeout",
                server_time=now.isoformat(),
            )

        if response is not None and (
            command is not None
            or expired_commands
            or command_scan_changed_state
            or response.reason
            in {
                "exposures",
                "revoked_jtis",
                "exposures_and_revoked_jtis",
                "command_and_exposures",
                "command_and_revoked_jtis",
                "command_and_reconcile",
                "state_changed",
            }
        ):
            await db.commit()
        return ControlCheck(target_id=auth.target_id, response=response)


async def timeout_response(
    *,
    body: WorkerControlWaitRequest,
    authorization: str | None,
) -> WorkerControlWaitResponse:
    check = await check_worker_control(
        body=body,
        authorization=authorization,
        timeout_response=True,
    )
    if check.response is None:
        raise CloudApiError(
            "cloud_worker_control_timeout_missing",
            "Worker control timeout response could not be built.",
            status_code=500,
        )
    return check.response


def _exposure_responses(
    snapshots: tuple[worker_exposures_store.WorkerExposureSnapshot, ...],
) -> list[WorkerExposureSnapshotResponse]:
    return [
        WorkerExposureSnapshotResponse(
            exposure_id=str(snapshot.exposure_id),
            target_id=str(snapshot.target_id),
            cloud_workspace_id=str(snapshot.cloud_workspace_id),
            session_projection_id=(
                str(snapshot.session_projection_id)
                if snapshot.session_projection_id is not None
                else None
            ),
            anyharness_workspace_id=snapshot.anyharness_workspace_id,
            anyharness_session_id=snapshot.anyharness_session_id,
            projection_level=snapshot.projection_level,
            commandable=snapshot.commandable,
            status=snapshot.status,
            revision=snapshot.revision,
            last_uploaded_seq=snapshot.last_uploaded_seq,
        )
        for snapshot in snapshots
    ]


def _control_reason(
    *,
    command: bool,
    exposures: bool,
    revoked_jtis: bool,
) -> str:
    if command and exposures and revoked_jtis:
        return "command_and_reconcile"
    if command and exposures:
        return "command_and_exposures"
    if command and revoked_jtis:
        return "command_and_revoked_jtis"
    if command:
        return "command"
    if exposures and revoked_jtis:
        return "exposures_and_revoked_jtis"
    if exposures:
        return "exposures"
    if revoked_jtis:
        return "revoked_jtis"
    return "state_changed"
