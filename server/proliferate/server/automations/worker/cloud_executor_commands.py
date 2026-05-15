"""CloudCommand helpers for the cloud automation executor."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from proliferate.constants.cloud import (
    CloudCommandActorKind,
    CloudCommandSource,
    CloudCommandStatus,
)
from proliferate.db import engine as db_engine
from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.server.cloud.commands.domain.rules import compact_command_json
from proliferate.utils.time import utcnow

COMMAND_WAIT_POLL_SECONDS = 1.0


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
    session_id: str | None = None,
) -> commands_store.CloudCommandSnapshot:
    idempotency_scope = _idempotency_scope(claim, target_id=target_id)
    idempotency_key = stage
    async with db_engine.async_session_factory() as db, db.begin():
        existing = await commands_store.get_command_by_idempotency(
            db,
            idempotency_scope=idempotency_scope,
            idempotency_key=idempotency_key,
        )
        if existing is not None:
            return existing
        return await commands_store.create_command(
            db,
            idempotency_scope=idempotency_scope,
            idempotency_key=idempotency_key,
            target_id=target_id,
            organization_id=organization_id,
            actor_user_id=claim.user_id,
            actor_kind=CloudCommandActorKind.automation.value,
            source=CloudCommandSource.automation.value,
            workspace_id=workspace_id,
            session_id=session_id,
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
