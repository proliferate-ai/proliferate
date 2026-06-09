"""Worker command lease and result orchestration."""

from __future__ import annotations

import json
import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudCommandKind, CloudCommandStatus
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_sync import command_leases as command_leases_store
from proliferate.db.store.cloud_sync import command_records
from proliferate.db.store.cloud_sync import command_results as command_results_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.commands.client_state import (
    expire_stale_client_commands_for_target,
    mark_pending_prompt_interaction_failed_for_command,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.live.service import publish_command_status_after_commit
from proliferate.server.cloud.worker.domain.rules import (
    clamp_command_lease_seconds,
    compact_json,
    normalize_supported_command_kinds,
    validate_delivery_status,
    validate_result_status,
)
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.server.cloud.worker.models import (
    WorkerCommandDeliveryRequest,
    WorkerCommandEnvelope,
    WorkerCommandLeaseRequest,
    WorkerCommandLeaseResponse,
    WorkerCommandResultRequest,
    WorkerCommandStatusResponse,
)
from proliferate.server.cloud.worker.target_validation import (
    require_current_worker_target as _require_current_worker_target,
)
from proliferate.utils.time import utcnow


def _parse_json_dict(value: str | None) -> dict[str, object] | None:
    if value is None:
        return None
    parsed = json.loads(value)
    if isinstance(parsed, dict):
        return parsed
    return {"value": parsed}


def command_envelope(
    command: command_records.CloudCommandSnapshot,
) -> WorkerCommandEnvelope:
    payload = _parse_json_dict(command.payload_json) or {}
    return WorkerCommandEnvelope(
        command_id=str(command.id),
        idempotency_key=command.idempotency_key,
        target_id=str(command.target_id),
        workspace_id=command.workspace_id,
        cloud_workspace_id=(
            str(command.cloud_workspace_id) if command.cloud_workspace_id else None
        ),
        sandbox_profile_id=_sandbox_profile_id_from_payload(command.payload_json),
        session_id=command.session_id,
        kind=command.kind,
        payload=_worker_delivery_payload(command, payload),
        observed_event_seq=command.observed_event_seq,
        preconditions=_parse_json_dict(command.preconditions_json),
        lease_id=command.lease_id or "",
        lease_expires_at=command.lease_expires_at.isoformat() if command.lease_expires_at else "",
    )


def _sandbox_profile_id_from_payload(payload_json: str) -> str | None:
    value = _parse_json_dict(payload_json) or {}
    sandbox_profile_id = value.get("sandboxProfileId")
    return sandbox_profile_id if isinstance(sandbox_profile_id, str) else None


def _worker_delivery_payload(
    command: command_records.CloudCommandSnapshot,
    payload: dict[str, object],
) -> dict[str, object]:
    if command.kind == CloudCommandKind.start_session.value:
        sanitized = dict(payload)
        _ensure_expected_runtime_config_revision(
            sanitized,
            target_id=str(command.target_id),
        )
        _strip_cloud_launch_preflight_fields(sanitized, strip_sandbox_profile_id=False)
        return sanitized
    if command.kind == CloudCommandKind.send_prompt.value:
        sanitized = dict(payload)
        _strip_cloud_launch_preflight_fields(sanitized)
        sanitized.pop("agentAuthScope", None)
        sanitized.pop("requiredAgentAuthRevision", None)
        return sanitized
    return payload


def _ensure_expected_runtime_config_revision(
    payload: dict[str, object],
    *,
    target_id: str,
) -> None:
    if isinstance(payload.get("expectedRuntimeConfigRevision"), dict):
        return
    sandbox_profile_id = payload.get("sandboxProfileId")
    revision_id = payload.get("requiredRuntimeConfigRevisionId")
    sequence = payload.get("requiredRuntimeConfigSequence")
    content_hash = payload.get("requiredRuntimeConfigContentHash")
    if not (
        isinstance(sandbox_profile_id, str)
        and isinstance(revision_id, str)
        and isinstance(sequence, int)
        and not isinstance(sequence, bool)
        and isinstance(content_hash, str)
    ):
        return
    payload["expectedRuntimeConfigRevision"] = {
        "revisionId": revision_id,
        "sequence": sequence,
        "contentHash": content_hash,
        "externalScope": {
            "provider": "proliferate-cloud",
            "id": sandbox_profile_id,
            "targetId": target_id,
        },
    }


def _strip_cloud_launch_preflight_fields(
    payload: dict[str, object],
    *,
    strip_sandbox_profile_id: bool = True,
) -> None:
    if strip_sandbox_profile_id:
        payload.pop("sandboxProfileId", None)
    payload.pop("requiredRuntimeConfigRevisionId", None)
    payload.pop("requiredRuntimeConfigSequence", None)
    payload.pop("requiredRuntimeConfigContentHash", None)


def _optional_uuid(value: str | None, *, field_name: str) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(value)
    except ValueError as exc:
        raise CloudApiError(
            "cloud_worker_invalid_uuid",
            f"{field_name} must be a UUID.",
            status_code=400,
        ) from exc


async def prepare_worker_command_lease(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerCommandLeaseRequest,
) -> tuple[WorkerCommandLeaseResponse, bool]:
    supported_kinds = normalize_supported_command_kinds(body.supported_kinds)
    lease_seconds = clamp_command_lease_seconds(body.lease_timeout_seconds)
    now = utcnow()
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    _require_current_worker_target(target)
    expired_commands = await expire_stale_client_commands_for_target(
        db,
        target_id=auth.target_id,
    )
    command = await command_leases_store.lease_next_command(
        db,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        supported_kinds=supported_kinds,
        lease_id=secrets.token_urlsafe(24),
        lease_expires_at=now + timedelta(seconds=lease_seconds),
        now=now,
    )
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
        # Workers report delivery immediately after receiving a lease. The lease
        # must be committed before the HTTP response is returned, otherwise the
        # delivery request can race the request-session commit and fail closed as
        # "not leased by this worker."
    response = WorkerCommandLeaseResponse(
        command=command_envelope(command) if command is not None else None,
        server_time=now.isoformat(),
    )
    return response, bool(command is not None or expired_commands)


async def record_command_delivery(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    command_id: UUID,
    body: WorkerCommandDeliveryRequest,
) -> WorkerCommandStatusResponse:
    status = validate_delivery_status(body.status)
    now = utcnow()
    if status == CloudCommandStatus.failed_delivery.value:
        command = await command_results_store.mark_command_failed_delivery(
            db,
            command_id=command_id,
            worker_id=auth.worker_id,
            lease_id=body.lease_id,
            error_code=body.error_code,
            error_message=body.error_message,
            now=now,
        )
    else:
        command = await command_results_store.mark_command_delivered(
            db,
            command_id=command_id,
            worker_id=auth.worker_id,
            lease_id=body.lease_id,
            now=now,
        )
    if command is None:
        raise CloudApiError(
            "cloud_worker_command_not_leased",
            "Command is not leased by this worker.",
            status_code=404,
        )
    log_cloud_event(
        "cloud worker command delivery recorded",
        command_id=command.id,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        kind=command.kind,
        status=command.status,
        error_code=command.error_code,
        workspace_id=command.workspace_id,
        session_id=command.session_id,
        cloud_workspace_id=command.cloud_workspace_id,
    )
    if _command_result_should_fail_pending_prompt(command):
        await mark_pending_prompt_interaction_failed_for_command(db, command)
    await publish_command_status_after_commit(db, command)
    return WorkerCommandStatusResponse(
        command_id=str(command.id),
        status=command.status,
        updated=True,
    )


async def _record_agent_auth_state_from_command_result(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    command: command_records.CloudCommandSnapshot,
    body: WorkerCommandResultRequest,
    status: str,
) -> None:
    """Accept refresh command results as a compatibility materialization signal.

    New workers report the detailed status endpoint during materialization.
    Older deployed worker bundles may only return an accepted command result;
    the command result is still target-scoped and worker-authenticated, so it is
    sufficient to mark the target current for the reported revision.
    """

    if command.kind != CloudCommandKind.refresh_agent_auth_config.value:
        return
    if status not in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
    }:
        return
    try:
        payload = json.loads(command.payload_json or "{}")
    except ValueError:
        return
    if not isinstance(payload, dict):
        return
    try:
        sandbox_profile_id = UUID(str(payload.get("sandboxProfileId") or ""))
        revision = int(payload.get("revision"))
    except (TypeError, ValueError):
        return
    result = body.result or {}
    if not isinstance(result, dict):
        return
    current_revision = _optional_int_result_field(result.get("currentRevision"))
    existing = await agent_auth_store.get_target_state(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=auth.target_id,
    )
    if existing is not None and existing.desired_revision > revision:
        return
    if (
        existing is not None
        and existing.last_command_id is not None
        and existing.last_command_id != command.id
        and existing.desired_revision >= revision
    ):
        return
    applied_revision = existing.applied_revision if existing is not None else None
    desired_revision = max(revision, current_revision or revision)
    state_status = "superseded"
    if result.get("applied") is True and desired_revision <= revision:
        applied_revision = revision
        desired_revision = revision
        state_status = "applied"
    elif current_revision is None and result.get("reason") != "superseded":
        return
    force_restart_required = existing.force_restart_required if existing is not None else False
    if state_status == "applied":
        force_restart_required = False
    await agent_auth_store.upsert_target_state(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=auth.target_id,
        desired_revision=desired_revision,
        applied_revision=applied_revision,
        status=state_status,
        force_restart_required=force_restart_required,
        last_command_id=command.id,
        last_worker_id=auth.worker_id,
        last_error_code=None,
        last_error_message=None,
    )


def _optional_int_result_field(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


async def record_command_result(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    command_id: UUID,
    body: WorkerCommandResultRequest,
) -> WorkerCommandStatusResponse:
    status = validate_result_status(body.status)
    command = await command_results_store.record_command_result(
        db,
        command_id=command_id,
        worker_id=auth.worker_id,
        lease_id=body.lease_id,
        status=status,
        error_code=body.error_code,
        error_message=body.error_message,
        result_json=compact_json(body.result),
        cloud_workspace_id=_optional_uuid(
            body.cloud_workspace_id,
            field_name="cloudWorkspaceId",
        ),
        anyharness_workspace_id=body.anyharness_workspace_id,
        now=utcnow(),
    )
    if command is None:
        raise CloudApiError(
            "cloud_worker_command_not_leased",
            "Command is not leased by this worker.",
            status_code=404,
        )
    log_cloud_event(
        "cloud worker command result recorded",
        command_id=command.id,
        target_id=auth.target_id,
        worker_id=auth.worker_id,
        kind=command.kind,
        status=command.status,
        error_code=command.error_code,
        workspace_id=command.workspace_id,
        session_id=command.session_id,
        cloud_workspace_id=command.cloud_workspace_id,
    )
    await _record_agent_auth_state_from_command_result(
        db,
        auth=auth,
        command=command,
        body=body,
        status=command.status,
    )
    if _command_result_should_fail_pending_prompt(command):
        await mark_pending_prompt_interaction_failed_for_command(db, command)
    await publish_command_status_after_commit(db, command)
    return WorkerCommandStatusResponse(
        command_id=str(command.id),
        status=command.status,
        updated=True,
    )


def _command_result_should_fail_pending_prompt(
    command: command_records.CloudCommandSnapshot,
) -> bool:
    return command.kind == CloudCommandKind.send_prompt.value and command.status in {
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.failed_delivery.value,
        CloudCommandStatus.superseded.value,
    }
