"""CloudCommand helpers for the cloud automation executor."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudCommandActorKind,
    CloudCommandKind,
    CloudCommandSource,
    CloudCommandStatus,
)
from proliferate.db import engine as db_engine
from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue
from proliferate.db.store.cloud_profile_target_guard import managed_profile_target_requires_slot
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import events as events_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.commands.domain.rules import compact_command_json
from proliferate.server.cloud.commands.preflight import stamp_and_validate_command_preflight
from proliferate.server.cloud.commands.wake import (
    kick_off_command_wake_after_commit_if_required,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.utils.time import utcnow

COMMAND_WAIT_POLL_SECONDS = 1.0
_MANAGED_SESSION_COMMAND_KINDS = {
    CloudCommandKind.send_prompt.value,
    CloudCommandKind.decide_plan.value,
    CloudCommandKind.resolve_interaction.value,
    CloudCommandKind.update_session_config.value,
    CloudCommandKind.cancel_turn.value,
    CloudCommandKind.close_session.value,
}


@dataclass(frozen=True)
class AutomationCommandResult:
    command: commands_store.CloudCommandSnapshot
    result: dict[str, object]
    body: dict[str, object]


def _idempotency_scope(claim: AutomationRunClaimValue, *, target_id: UUID) -> str:
    return f"automation_run:{claim.id}:target:{target_id}"


async def enqueue_automation_command(
    claim: AutomationRunClaimValue,
    *,
    target_id: UUID,
    organization_id: UUID | None = None,
    stage: str,
    kind: str,
    payload: dict[str, object],
    workspace_id: str | None = None,
    cloud_workspace_id: UUID | None = None,
    session_id: str | None = None,
) -> commands_store.CloudCommandSnapshot:
    idempotency_scope = _idempotency_scope(claim, target_id=target_id)
    idempotency_key = stage
    async with db_engine.async_session_factory() as db, db.begin():
        target = await targets_store.get_target_by_id(db, target_id)
        if target is None:
            raise CloudApiError(
                "cloud_command_target_not_found",
                "Target not found.",
                status_code=404,
            )
        payload = await stamp_and_validate_command_preflight(
            db,
            actor_user_id=claim.user_id,
            target_id=target_id,
            kind=kind,
            payload=payload,
        )
        resolved_workspace_id, resolved_cloud_workspace_id, payload = await _resolve_scope(
            db,
            target=target,
            kind=kind,
            workspace_id=workspace_id,
            cloud_workspace_id=cloud_workspace_id,
            session_id=session_id,
            payload=payload,
        )
        existing = await commands_store.get_command_by_idempotency(
            db,
            idempotency_scope=idempotency_scope,
            idempotency_key=idempotency_key,
        )
        if existing is not None:
            expected_payload_json = compact_command_json(payload) or "{}"
            if existing.payload_json != expected_payload_json:
                raise CloudApiError(
                    "cloud_command_runtime_config_unstamped",
                    "Existing automation command is missing required runtime config preflight.",
                    status_code=409,
                )
            await kick_off_command_wake_after_commit_if_required(
                db,
                target=target,
                command=existing,
            )
            return existing
        command = await commands_store.create_command(
            db,
            idempotency_scope=idempotency_scope,
            idempotency_key=idempotency_key,
            target_id=target_id,
            organization_id=organization_id,
            actor_user_id=claim.user_id,
            actor_kind=CloudCommandActorKind.automation.value,
            source=CloudCommandSource.automation.value,
            workspace_id=resolved_workspace_id,
            session_id=session_id,
            cloud_workspace_id=resolved_cloud_workspace_id,
            kind=kind,
            payload_json=compact_command_json(payload) or "{}",
            observed_event_seq=None,
            preconditions_json=None,
            authorization_context_json=compact_command_json(
                {
                    "automationId": str(claim.automation_id),
                    "automationRunId": str(claim.id),
                    "claimId": str(claim.claim_id),
                    "targetOrganizationId": (
                        str(organization_id) if organization_id is not None else None
                    ),
                }
            ),
        )
        await kick_off_command_wake_after_commit_if_required(
            db,
            target=target,
            command=command,
        )
        return command


async def _resolve_scope(
    db: AsyncSession,
    *,
    target: targets_store.CloudTargetSnapshot,
    kind: str,
    workspace_id: str | None,
    cloud_workspace_id: UUID | None,
    session_id: str | None,
    payload: dict[str, object],
) -> tuple[str | None, UUID | None, dict[str, object]]:
    if not _target_requires_cloud_workspace(target):
        return workspace_id, cloud_workspace_id, payload
    if kind == CloudCommandKind.start_session.value:
        if cloud_workspace_id is None:
            raise CloudApiError(
                "cloud_command_cloud_workspace_required",
                "Managed automation start_session commands require cloudWorkspaceId.",
                status_code=400,
            )
        exposure = await exposures_store.get_active_workspace_exposure(
            db,
            target_id=target.id,
            cloud_workspace_id=cloud_workspace_id,
        )
        if (
            exposure is None
            or exposure.archived_at is not None
            or exposure.status != "active"
            or not exposure.anyharness_workspace_id
        ):
            raise CloudApiError(
                "cloud_command_exposure_not_active",
                "Automation workspace is not exposed for Cloud commands.",
                status_code=409,
            )
        if not exposure.commandable:
            raise CloudApiError(
                "cloud_command_exposure_not_commandable",
                "Automation workspace exposure is read-only.",
                status_code=409,
            )
        next_payload = dict(payload)
        next_payload["workspaceId"] = exposure.anyharness_workspace_id
        return exposure.anyharness_workspace_id, cloud_workspace_id, next_payload
    if kind not in _MANAGED_SESSION_COMMAND_KINDS:
        return workspace_id, cloud_workspace_id, payload
    if not session_id:
        raise CloudApiError(
            "cloud_command_session_required",
            f"Cloud command kind requires sessionId: {kind}",
            status_code=400,
        )
    projection = await events_store.get_session_projection(
        db,
        target_id=target.id,
        session_id=session_id,
    )
    if projection is None or projection.cloud_workspace_id is None:
        raise CloudApiError(
            "cloud_command_session_not_projected",
            "Session is not projected into Cloud.",
            status_code=409,
        )
    if cloud_workspace_id is not None and cloud_workspace_id != projection.cloud_workspace_id:
        raise CloudApiError(
            "cloud_command_workspace_target_mismatch",
            "Session is not attached to the requested Cloud workspace.",
            status_code=409,
        )
    exposure = None
    if projection.exposure_id is not None:
        exposure = await exposures_store.get_workspace_exposure_by_id(
            db,
            projection.exposure_id,
        )
    if exposure is None or exposure.archived_at is not None or exposure.status != "active":
        raise CloudApiError(
            "cloud_command_exposure_not_active",
            "Session is not exposed for Cloud commands.",
            status_code=409,
        )
    if not exposure.commandable or not projection.commandable:
        raise CloudApiError(
            "cloud_command_exposure_not_commandable",
            "Session exposure is read-only.",
            status_code=409,
        )
    return projection.workspace_id or workspace_id, projection.cloud_workspace_id, payload


def _target_requires_cloud_workspace(target: targets_store.CloudTargetSnapshot) -> bool:
    return managed_profile_target_requires_slot(
        kind=target.kind,
        sandbox_profile_id=target.sandbox_profile_id,
        profile_target_role=target.profile_target_role,
    )


async def load_command(
    command_id: UUID,
) -> commands_store.CloudCommandSnapshot | None:
    async with db_engine.async_session_factory() as db:
        return await commands_store.get_command_by_id(db, command_id)


async def expire_command(
    command: commands_store.CloudCommandSnapshot,
    *,
    error_code: str,
    error_message: str,
) -> commands_store.CloudCommandSnapshot | None:
    async with db_engine.async_session_factory() as db, db.begin():
        return await commands_store.expire_command_if_not_terminal(
            db,
            command_id=command.id,
            error_code=error_code,
            error_message=error_message,
            now=utcnow(),
        )


async def wait_for_command_result(
    command: commands_store.CloudCommandSnapshot,
    *,
    timeout: timedelta,
) -> AutomationCommandResult:
    deadline = utcnow() + timeout
    current = command
    while utcnow() < deadline:
        refreshed = await load_command(current.id)
        if refreshed is None:
            raise RuntimeError("Cloud command disappeared before completion.")
        current = refreshed
        if current.status in {
            CloudCommandStatus.accepted.value,
            CloudCommandStatus.accepted_but_queued.value,
        }:
            result = _result_json(current)
            return AutomationCommandResult(
                command=current,
                result=result,
                body=_body_from_result(result),
            )
        if current.status in {
            CloudCommandStatus.rejected.value,
            CloudCommandStatus.failed_delivery.value,
            CloudCommandStatus.expired.value,
            CloudCommandStatus.superseded.value,
        }:
            message = current.error_message or f"Cloud command ended with status {current.status}."
            raise RuntimeError(message)
        await asyncio.sleep(COMMAND_WAIT_POLL_SECONDS)
    expired = await expire_command(
        current,
        error_code="automation_command_timeout",
        error_message="Timed out waiting for cloud command completion.",
    )
    if expired is not None and expired.status in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
    }:
        result = _result_json(expired)
        return AutomationCommandResult(
            command=expired, result=result, body=_body_from_result(result)
        )
    raise TimeoutError("Timed out waiting for cloud command completion.")


def _result_json(command: commands_store.CloudCommandSnapshot) -> dict[str, object]:
    if not command.result_json:
        return {}
    parsed = json.loads(command.result_json)
    return parsed if isinstance(parsed, dict) else {}


def _body_from_result(parsed: dict[str, object]) -> dict[str, object]:
    body = parsed.get("body")
    return body if isinstance(body, dict) else {}
