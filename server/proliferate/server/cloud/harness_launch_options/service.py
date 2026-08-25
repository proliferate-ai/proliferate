from __future__ import annotations

from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudSandboxStatus
from proliferate.db.store import harness_launch_options as launch_options_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.server.api_errors import CloudApiError
from proliferate.server.cloud.harness_launch_options.models import (
    AgentReadiness,
    CopiedLaunchOptionsResponse,
    CopiedLaunchOptionsState,
    LaunchOptionsCopyRequest,
)

_copied_state_adapter = TypeAdapter(CopiedLaunchOptionsState)
_json_object_adapter = TypeAdapter(dict[str, object])


def _validated_payload(
    body: LaunchOptionsCopyRequest,
    harness_kind: str,
) -> CopiedLaunchOptionsState:
    try:
        raw_payload = _json_object_adapter.validate_json(body.payload_json)
    except (TypeError, ValueError) as error:
        raise CloudApiError(
            "invalid_launch_options_payload",
            "Launch-option payload is not a valid JSON object.",
            status_code=400,
        ) from error
    try:
        payload = _copied_state_adapter.validate_python(raw_payload)
    except (TypeError, ValueError) as error:
        raise CloudApiError(
            "invalid_launch_options_envelope",
            "Launch-option payload is not valid copied target state.",
            status_code=400,
        ) from error
    if payload.harness_kind != harness_kind or payload.revision != body.source_revision:
        raise CloudApiError(
            "invalid_launch_options_envelope",
            "Launch-option envelope does not match its target or revision.",
            status_code=400,
        )
    return payload


def _target_readiness(status: str) -> AgentReadiness:
    return "ready" if status == CloudSandboxStatus.ready.value else "error"


async def ingest_launch_options(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
    harness_kind: str,
    body: LaunchOptionsCopyRequest,
) -> None:
    _validated_payload(body, harness_kind)
    await launch_options_store.upsert_if_newer(
        db,
        cloud_sandbox_id=cloud_sandbox_id,
        harness_kind=harness_kind,
        source_revision=body.source_revision,
        payload_json=body.payload_json,
    )


async def get_launch_options(
    db: AsyncSession,
    *,
    sandbox: CloudSandboxValue,
    harness_kind: str,
) -> dict[str, object]:
    record = await launch_options_store.get(
        db,
        cloud_sandbox_id=sandbox.id,
        harness_kind=harness_kind,
    )
    if record is None:
        raise CloudApiError(
            "harness_launch_options_not_observed",
            "Harness launch options have not been observed on this target.",
            status_code=404,
        )
    payload = TypeAdapter(dict[str, object]).validate_json(record.payload_json)
    response = {**payload, "readiness": _target_readiness(sandbox.status)}
    TypeAdapter(CopiedLaunchOptionsResponse).validate_python(response)
    return response
