"""Cloud workflows API routes.

Route order matters: the literal ``/runs`` sub-routes are declared before the
``/{workflow_id}`` parameter routes so ``GET /workflows/runs`` is not swallowed as
a workflow lookup with id ``"runs"``.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.constants.workflows import WORKFLOW_TARGET_MODE_PERSONAL_CLOUD
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.workflows.delivery import deliver_cloud_run, refresh_cloud_run
from proliferate.server.cloud.workflows.models import (
    RunStatusRequest,
    StartRunRequest,
    WorkflowCreateRequest,
    WorkflowDetailResponse,
    WorkflowListResponse,
    WorkflowResponse,
    WorkflowRunListResponse,
    WorkflowRunResponse,
    WorkflowTriggerCreateRequest,
    WorkflowTriggerListResponse,
    WorkflowTriggerResponse,
    WorkflowTriggerUpdateRequest,
    WorkflowUpdateRequest,
    run_payload,
    trigger_payload,
    workflow_detail_payload,
    workflow_payload,
)
from proliferate.server.cloud.workflows.service import (
    archive_workflow,
    create_trigger,
    create_workflow,
    delete_trigger,
    get_run,
    get_trigger,
    get_workflow_detail,
    list_runs,
    list_triggers,
    list_workflows,
    mark_run_delivered,
    report_run_status,
    start_run,
    update_trigger,
    update_workflow,
)

router = APIRouter(prefix="/workflows", tags=["cloud-workflows"])


@router.get("", response_model=WorkflowListResponse)
async def list_workflows_endpoint(
    include_archived: Annotated[bool, Query(alias="includeArchived")] = False,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowListResponse:
    workflows = await list_workflows(db, user, include_archived=include_archived)
    return WorkflowListResponse(workflows=[workflow_payload(w) for w in workflows])


@router.post("", response_model=WorkflowDetailResponse)
async def create_workflow_endpoint(
    body: WorkflowCreateRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowDetailResponse:
    workflow, versions = await create_workflow(db, user, body)
    return workflow_detail_payload(workflow, versions)


@router.get("/runs", response_model=WorkflowRunListResponse)
async def list_runs_endpoint(
    workflow_id: Annotated[UUID | None, Query(alias="workflowId")] = None,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowRunListResponse:
    runs = await list_runs(db, user, workflow_id=workflow_id)
    return WorkflowRunListResponse(runs=[run_payload(r) for r in runs])


@router.get("/runs/{run_id}", response_model=WorkflowRunResponse)
async def get_run_endpoint(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowRunResponse:
    return run_payload(await get_run(db, user, run_id))


@router.post("/runs/{run_id}/delivered", response_model=WorkflowRunResponse)
async def mark_run_delivered_endpoint(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowRunResponse:
    return run_payload(await mark_run_delivered(db, user, run_id))


@router.post("/runs/{run_id}/status", response_model=WorkflowRunResponse)
async def report_run_status_endpoint(
    run_id: UUID,
    body: RunStatusRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowRunResponse:
    return run_payload(await report_run_status(db, user, run_id, body))


@router.post("/runs/{run_id}/deliver", response_model=WorkflowRunResponse)
async def redeliver_run_endpoint(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowRunResponse:
    """Retry cloud delivery for a run stuck in ``pending_delivery`` (idempotent)."""

    run = await get_run(db, user, run_id)
    return run_payload(await deliver_cloud_run(db, user, run))


@router.get("/runs/{run_id}/refresh", response_model=WorkflowRunResponse)
async def refresh_run_endpoint(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowRunResponse:
    """Pull observed state for a cloud run from the sandbox and sync the ledger.

    Cloud runs have no worker→server push channel in v1, so the UI polls this to
    keep the run view fresh; local runs stay fresh via the desktop relay.
    """

    run = await get_run(db, user, run_id)
    return run_payload(await refresh_cloud_run(db, user, run))


@router.get("/{workflow_id}", response_model=WorkflowDetailResponse)
async def get_workflow_endpoint(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowDetailResponse:
    workflow, versions = await get_workflow_detail(db, user, workflow_id)
    return workflow_detail_payload(workflow, versions)


@router.patch("/{workflow_id}", response_model=WorkflowDetailResponse)
async def update_workflow_endpoint(
    workflow_id: UUID,
    body: WorkflowUpdateRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowDetailResponse:
    workflow, versions = await update_workflow(db, user, workflow_id, body)
    return workflow_detail_payload(workflow, versions)


@router.delete("/{workflow_id}", response_model=WorkflowResponse)
async def archive_workflow_endpoint(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowResponse:
    return workflow_payload(await archive_workflow(db, user, workflow_id))


@router.post("/{workflow_id}/runs", response_model=WorkflowRunResponse)
async def start_run_endpoint(
    workflow_id: UUID,
    body: StartRunRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowRunResponse:
    run = await start_run(
        db,
        user,
        workflow_id,
        args=body.args,
        target_mode=body.target_mode,
        version_id=body.version_id,
        target_workspace_id=body.target_workspace_id,
    )
    # Cloud lane: the server delivers gateway-direct to sandbox anyharness in the
    # request (wake + POST). Local lane: the desktop client delivers to its own
    # local runtime and calls /delivered itself.
    if run.target_mode == WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        run = await deliver_cloud_run(db, user, run)
    return run_payload(run)


@router.get("/{workflow_id}/runs", response_model=WorkflowRunListResponse)
async def list_workflow_runs_endpoint(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowRunListResponse:
    runs = await list_runs(db, user, workflow_id=workflow_id)
    return WorkflowRunListResponse(runs=[run_payload(r) for r in runs])


# --- triggers (spec 3.5) -------------------------------------------------------


@router.get("/{workflow_id}/triggers", response_model=WorkflowTriggerListResponse)
async def list_triggers_endpoint(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowTriggerListResponse:
    triggers = await list_triggers(db, user, workflow_id)
    return WorkflowTriggerListResponse(triggers=[trigger_payload(t) for t in triggers])


@router.post("/{workflow_id}/triggers", response_model=WorkflowTriggerResponse)
async def create_trigger_endpoint(
    workflow_id: UUID,
    body: WorkflowTriggerCreateRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowTriggerResponse:
    return trigger_payload(await create_trigger(db, user, workflow_id, body))


@router.get("/{workflow_id}/triggers/{trigger_id}", response_model=WorkflowTriggerResponse)
async def get_trigger_endpoint(
    workflow_id: UUID,
    trigger_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowTriggerResponse:
    return trigger_payload(await get_trigger(db, user, workflow_id, trigger_id))


@router.patch("/{workflow_id}/triggers/{trigger_id}", response_model=WorkflowTriggerResponse)
async def update_trigger_endpoint(
    workflow_id: UUID,
    trigger_id: UUID,
    body: WorkflowTriggerUpdateRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowTriggerResponse:
    return trigger_payload(await update_trigger(db, user, workflow_id, trigger_id, body))


@router.delete("/{workflow_id}/triggers/{trigger_id}", status_code=204)
async def delete_trigger_endpoint(
    workflow_id: UUID,
    trigger_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> None:
    await delete_trigger(db, user, workflow_id, trigger_id)
