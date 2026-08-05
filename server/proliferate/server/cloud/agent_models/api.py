"""HTTP routes for cloud model snapshots: layered read, ingest, overrides.

Named off both "gateway" (these serve the composed observation, not one route)
and "catalog" (that word belongs to the shipped-catalog document), per
model-catalog.md §Cloud routes. One observation per harness: no
``authContextId`` parameter anywhere on this surface.

**One** router, with the auth identity chosen per route rather than per router:
the reads and overrides depend on ``current_product_user``, the single ingest
route depends on ``authenticate_worker``.

An earlier shape used two routers both prefixed ``/agent-models`` and was
withdrawn. FastAPI resolves a duplicate method+path to whichever registered
first and says nothing, so the two-router shape made "which auth guards this
path" depend on include order in ``cloud/api.py`` — a property no reader of
either file can see. Today's routes happen not to collide, which is exactly why
this was worth fixing now: the ingest endpoint has no shipped consumer yet (S2
builds the Worker caller), so the shape is free to change, and the next route
added under either prefix would have inherited a silent-shadowing hazard.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.agent_models import overrides as overrides_service
from proliferate.server.cloud.agent_models import snapshots as snapshots_service
from proliferate.server.cloud.agent_models.models import (
    AgentModelOverrideResponse,
    AgentModelOverrideUpsertRequest,
    AgentModelSnapshotIngestRequest,
    AgentModelsResponse,
    models_payload,
    override_payload,
)
from proliferate.server.cloud.runtime_workers.auth import (
    WorkerAuthContext,
    authenticate_worker,
)

router = APIRouter(prefix="/agent-models", tags=["cloud-agent-models"])


@router.get("/{harness_kind}", response_model=AgentModelsResponse)
async def get_agent_models_endpoint(
    harness_kind: str,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentModelsResponse:
    """The layered read: own snapshot, else the shipped catalog's models as the
    read-time seed, with the override patch applied.

    No ``authContextId`` and no ``surface`` params (model-catalog.md §Cloud
    routes): one composed observation per harness, cloud-sandbox observations
    only.
    """
    layered = await snapshots_service.get_models(
        db,
        user_id=user.id,
        harness_kind=harness_kind,
    )
    return models_payload(harness_kind=harness_kind, layered=layered)


@router.post("/{harness_kind}/refresh", response_model=AgentModelsResponse)
async def ingest_agent_model_snapshot_endpoint(
    harness_kind: str,
    body: AgentModelSnapshotIngestRequest,
    auth: WorkerAuthContext = Depends(authenticate_worker),
    db: AsyncSession = Depends(get_async_session),
) -> AgentModelsResponse:
    """The single ingest route: a Worker-uploaded machine document.

    Absorbs the former ``refresh``-with-payload and ``mirror`` endpoints, which
    were two names for the same write, and the server-side gateway discovery
    that used to live inside ``refresh`` — the server never generates snapshots.

    The body is the worker's wire shape verbatim — ``snapshotJson`` (the whole
    schemaVersion-2 document) plus ``probedAt``, nothing else. The owner is
    resolved from the Worker's sandbox row, so the body carries no user
    identity to spoof.
    """
    owner_user_id = await snapshots_service.resolve_upload_owner(
        db,
        runtime_kind=auth.runtime_kind,
        cloud_sandbox_id=auth.cloud_sandbox_id,
    )
    layered = await snapshots_service.ingest_snapshot(
        db,
        owner_user_id=owner_user_id,
        harness_kind=harness_kind,
        snapshot_json=body.snapshot_json,
        probed_at=body.probed_at,
    )
    return models_payload(harness_kind=harness_kind, layered=layered)


@router.put("/{harness_kind}/override", response_model=AgentModelOverrideResponse)
async def upsert_agent_model_override_endpoint(
    harness_kind: str,
    body: AgentModelOverrideUpsertRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> AgentModelOverrideResponse:
    record = await overrides_service.upsert_override(
        db,
        user_id=user.id,
        harness_kind=harness_kind,
        patch_json=body.patch_json,
    )
    return override_payload(record)


@router.delete("/{harness_kind}/override", status_code=204)
async def delete_agent_model_override_endpoint(
    harness_kind: str,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> None:
    await overrides_service.delete_override(
        db,
        user_id=user.id,
        harness_kind=harness_kind,
    )
