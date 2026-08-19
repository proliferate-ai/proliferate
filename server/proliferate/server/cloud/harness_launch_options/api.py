from __future__ import annotations

import json
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.sandboxes import CloudSandbox, HarnessLaunchOptionState
from proliferate.lib.infra.time.wall_clock import utcnow
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime_workers.auth import WorkerAuthContext, authenticate_worker

router = APIRouter(prefix="/harness-launch-options", tags=["cloud-harness-launch-options"])


class LaunchOptionsCopyRequest(BaseModel):
    model_config = ConfigDict(alias_generator=lambda value: "".join(
        [value.split("_")[0], *[part.title() for part in value.split("_")[1:]]]
    ), populate_by_name=True)
    source_revision: int
    payload_json: str


class LaunchModel(BaseModel):
    model_config = ConfigDict(alias_generator=lambda value: "".join(
        [value.split("_")[0], *[part.title() for part in value.split("_")[1:]]]
    ), populate_by_name=True)
    id: str
    observed_name: str | None
    observed_description: str | None


class LaunchControlValue(BaseModel):
    model_config = LaunchModel.model_config
    value: str
    observed_label: str | None
    observed_description: str | None


class LaunchControl(BaseModel):
    model_config = LaunchModel.model_config
    id: str
    observed_label: str | None
    observed_description: str | None
    values: list[LaunchControlValue]


class LaunchDefaults(BaseModel):
    model_config = LaunchModel.model_config
    model_id: str | None
    control_values: dict[str, str]


class LaunchOptions(BaseModel):
    models: list[LaunchModel]
    controls: list[LaunchControl]
    defaults: LaunchDefaults


class CopiedLaunchOptionsResponse(BaseModel):
    model_config = LaunchModel.model_config
    harness_kind: str
    basis_revision: str
    revision: int
    state: Literal[
        "detecting",
        "refreshing",
        "observed",
        "observed_empty",
        "last_good_after_failure",
        "failed_without_observation",
    ]
    options: LaunchOptions | None
    observed_at: str | None
    probe_attempted_at: str
    probe_failure_code: str | None
    readiness: str | None = None


def _validated_payload(body: LaunchOptionsCopyRequest, harness_kind: str) -> dict[str, Any]:
    try:
        payload = json.loads(body.payload_json)
    except (TypeError, ValueError) as error:
        raise CloudApiError("invalid_launch_options_payload", "Launch-option payload is not valid JSON.", status_code=400) from error
    if not isinstance(payload, dict):
        raise CloudApiError("invalid_launch_options_payload", "Launch-option payload must be an object.", status_code=400)
    if payload.get("harnessKind") != harness_kind or payload.get("revision") != body.source_revision:
        raise CloudApiError("invalid_launch_options_envelope", "Launch-option envelope does not match its target or revision.", status_code=400)
    if "readiness" in payload:
        raise CloudApiError("invalid_launch_options_envelope", "Copied launch-option state must not contain readiness.", status_code=400)
    required = {"basisRevision", "state", "options", "observedAt", "probeAttemptedAt", "probeFailureCode"}
    if not required.issubset(payload):
        raise CloudApiError("invalid_launch_options_envelope", "Launch-option envelope is incomplete.", status_code=400)
    return payload


@router.post("/{harness_kind}", status_code=204)
async def ingest_launch_options(
    harness_kind: str,
    body: LaunchOptionsCopyRequest,
    auth: WorkerAuthContext = Depends(authenticate_worker),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    if auth.runtime_kind != "cloud_sandbox" or auth.cloud_sandbox_id is None:
        raise CloudApiError("launch_options_target_required", "Launch options require a cloud sandbox target.", status_code=403)
    _validated_payload(body, harness_kind)
    statement = insert(HarnessLaunchOptionState).values(
        cloud_sandbox_id=auth.cloud_sandbox_id,
        harness_kind=harness_kind,
        source_revision=body.source_revision,
        payload_json=body.payload_json,
        copied_at=utcnow(),
    )
    statement = statement.on_conflict_do_update(
        index_elements=[HarnessLaunchOptionState.cloud_sandbox_id, HarnessLaunchOptionState.harness_kind],
        set_={
            "source_revision": statement.excluded.source_revision,
            "payload_json": statement.excluded.payload_json,
            "copied_at": statement.excluded.copied_at,
        },
        where=statement.excluded.source_revision > HarnessLaunchOptionState.source_revision,
    )
    await db.execute(statement)
    await db.commit()


@router.get("/sandboxes/{cloud_sandbox_id}/{harness_kind}", response_model=CopiedLaunchOptionsResponse)
async def get_launch_options(
    cloud_sandbox_id: UUID,
    harness_kind: str,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CopiedLaunchOptionsResponse:
    sandbox = await db.scalar(select(CloudSandbox).where(CloudSandbox.id == cloud_sandbox_id))
    if sandbox is None or sandbox.owner_user_id != user.id:
        raise CloudApiError("cloud_sandbox_not_found", "Cloud sandbox not found.", status_code=404)
    record = await db.scalar(select(HarnessLaunchOptionState).where(
        HarnessLaunchOptionState.cloud_sandbox_id == cloud_sandbox_id,
        HarnessLaunchOptionState.harness_kind == harness_kind,
    ))
    if record is None:
        raise CloudApiError("harness_launch_options_not_observed", "Harness launch options have not been observed on this target.", status_code=404)
    payload = json.loads(record.payload_json)
    return CopiedLaunchOptionsResponse.model_validate({**payload, "readiness": None})
