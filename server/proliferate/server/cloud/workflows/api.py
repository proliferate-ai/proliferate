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
from proliferate.constants.workflows import (
    WORKFLOW_POLL_MIN_INTERVAL_SECONDS,
)
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.workflows.access import (
    RunTokenActor,
    authorize_run_ping,
    authorize_run_report,
    require_workflows_enabled,
)
from proliferate.server.cloud.workflows.binding.api import router as binding_router
from proliferate.server.cloud.workflows.compiler import start_run
from proliferate.server.cloud.workflows.delivery import (
    cancel_run,
    deliver_cloud_run,
    observe_run_ping,
    refresh_cloud_run,
)
from proliferate.server.cloud.workflows.local_executor import (
    claim_local_workflow_runs,
    heartbeat_local_workflow_run,
)
from proliferate.server.cloud.workflows.local_models import (
    LocalWorkflowClaimActionRequest,
    LocalWorkflowClaimListResponse,
    LocalWorkflowClaimMutationResponse,
    LocalWorkflowClaimRequest,
)
from proliferate.server.cloud.workflows.models import (
    PollInputSpecResponse,
    PollInspectRequest,
    PollInspectResponse,
    PollSkippedFieldResponse,
    RunStatusRequest,
    SlackChannelResponse,
    SlackChannelsResponse,
    StartRunRequest,
    StepActionResponse,
    TriggerPollRequest,
    WorkflowCreateRequest,
    WorkflowDetailResponse,
    WorkflowListResponse,
    WorkflowResponse,
    WorkflowRunDetailResponse,
    WorkflowRunListResponse,
    WorkflowRunResponse,
    WorkflowTriggerCreateRequest,
    WorkflowTriggerItemListResponse,
    WorkflowTriggerListResponse,
    WorkflowTriggerResponse,
    WorkflowTriggerUpdateRequest,
    WorkflowUpdateRequest,
    run_payload,
    trigger_item_payload,
    trigger_payload,
    workflow_detail_payload,
    workflow_payload,
)
from proliferate.server.cloud.workflows.service import (
    archive_workflow,
    create_workflow,
    get_run,
    get_workflow_detail,
    list_run_step_actions,
    list_runs,
    list_slack_channels,
    list_workflows,
    update_workflow,
)
from proliferate.server.cloud.workflows.triggers import (
    create_trigger,
    delete_trigger,
    get_trigger,
    inspect_poll_endpoint,
    list_trigger_items,
    list_triggers,
    update_trigger,
)
from proliferate.server.cloud.workflows.worker.service import mark_run_delivered, report_run_status

router = APIRouter(
    prefix="/workflows",
    tags=["cloud-workflows"],
    dependencies=[Depends(require_workflows_enabled)],
)
router.include_router(binding_router)


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


@router.get("/runs/{run_id}", response_model=WorkflowRunDetailResponse)
async def get_run_endpoint(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowRunDetailResponse:
    run = await get_run(db, user, run_id)
    actions = await list_run_step_actions(db, run.id)
    return WorkflowRunDetailResponse(
        run=run_payload(run),
        step_actions=[
            StepActionResponse(
                step_key=a.step_key,
                action_kind=a.action_kind,
                status=a.status,
                result_json=a.result_json,
                error_message=a.error_message,
                attempt_count=a.attempt_count,
            )
            for a in actions
        ],
    )


@router.post("/runs/{run_id}/delivered", response_model=WorkflowRunResponse)
async def mark_run_delivered_endpoint(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    # Legacy auth remains mounted only to return the common feature-off gate.
    actor: RunTokenActor | User = Depends(authorize_run_report),
) -> WorkflowRunResponse:
    return run_payload(await mark_run_delivered(db, actor, run_id))


@router.post("/runs/{run_id}/status", response_model=WorkflowRunResponse)
async def report_run_status_endpoint(
    run_id: UUID,
    body: RunStatusRequest,
    db: AsyncSession = Depends(get_async_session),
    # No observed-state mutation exists until authenticated observation cutover.
    actor: RunTokenActor | User = Depends(authorize_run_report),
) -> WorkflowRunResponse:
    return run_payload(
        await report_run_status(
            db,
            actor,
            run_id,
            body,
            authed_via_run_token=isinstance(actor, RunTokenActor),
        )
    )


@router.post("/runs/{run_id}/cancel", response_model=WorkflowRunResponse)
async def cancel_run_endpoint(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowRunResponse:
    """Owner-scoped feature-off gate; pre-cutover runtime state stays parked."""

    return run_payload(await cancel_run(db, user, run_id))


@router.post("/runs/{run_id}/deliver", response_model=WorkflowRunResponse)
async def redeliver_run_endpoint(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowRunResponse:
    """Feature-off gate; never wakes or contacts a runtime."""

    run = await get_run(db, user, run_id)
    return run_payload(await deliver_cloud_run(db, user, run))


@router.get("/runs/{run_id}/refresh", response_model=WorkflowRunResponse)
async def refresh_run_endpoint(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowRunResponse:
    """Feature-off gate; never reads runtime state or mutates observations."""

    run = await get_run(db, user, run_id)
    return run_payload(await refresh_cloud_run(db, user, run))


@router.post("/runs/{run_id}/ping", status_code=202)
async def run_ping_endpoint(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    # Legacy bearer lookup only; WF-ID creates no token and the service always
    # stops at the final-envelope feature-off gate.
    actor: RunTokenActor = Depends(authorize_run_ping),
) -> None:
    """Legacy ping gate; no refresh or observation mutation."""

    await observe_run_ping(db, run_id=run_id, actor=actor)


# --- desktop executor claim plane (track 2a) -----------------------------------
# Literal paths declared BEFORE the "/{workflow_id}" param routes (same reason the
# "/runs" routes lead). Auth = the desktop's user session; every claim is
# owner-scoped in the service, so a session can only claim its own local runs.


@router.post("/executor/local/claims", response_model=LocalWorkflowClaimListResponse)
async def claim_local_workflow_runs_endpoint(
    body: LocalWorkflowClaimRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> LocalWorkflowClaimListResponse:
    """Claim this owner's eligible local runs for a desktop executor.

    All local sources use this authority transition; an accepted binding is never
    stale-reclaimed into a different executor.
    """

    claimed = await claim_local_workflow_runs(db, user.id, body)
    await db.commit()
    return claimed


@router.post(
    "/executor/local/runs/{run_id}/heartbeat",
    response_model=LocalWorkflowClaimMutationResponse,
)
async def heartbeat_local_workflow_run_endpoint(
    run_id: UUID,
    body: LocalWorkflowClaimActionRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> LocalWorkflowClaimMutationResponse:
    """Renew a live claim's TTL (the 30s heartbeat). ``accepted=false`` means the
    claim was lost (reclaimed / terminal / expired) and the executor must stop."""

    return await heartbeat_local_workflow_run(db, user.id, run_id, body)


@router.get("/slack/channels", response_model=SlackChannelsResponse)
async def list_slack_channels_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> SlackChannelsResponse:
    result = await list_slack_channels(db, user)
    return SlackChannelsResponse(
        channels=[SlackChannelResponse(id=c.id, name=c.name) for c in result.channels],
        connected=result.connected,
    )


# --- poll setup: workflow-from-poll (flow 1, mental-model §5) ------------------
# Literal path declared BEFORE the "/{workflow_id}" param routes so it is not
# swallowed as a workflow lookup (same reason the "/runs" routes lead).


@router.post("/poll/inspect", response_model=PollInspectResponse)
async def inspect_poll_endpoint_route(
    body: PollInspectRequest,
    _user: User = Depends(current_product_user),
) -> PollInspectResponse:
    """Flow 1: probe an endpoint's reserved ``/init`` path and derive a new
    workflow's starting inputs from the sample item. No workflow/DB needed — this
    is a pure, bounded network probe; a bad ``/init`` raises ``poll_probe_failed``.
    """

    result = await inspect_poll_endpoint(
        TriggerPollRequest(
            url=body.url,
            authHeader=body.auth_header,
            authValue=body.auth_value,
            intervalSecs=WORKFLOW_POLL_MIN_INTERVAL_SECONDS,
        )
    )
    return PollInspectResponse(
        sampleItemId=result.sample_item_id,
        sampleData=result.sample_data,
        derivedInputs=[
            PollInputSpecResponse(name=i["name"], type=i["type"], required=i["required"])
            for i in result.derived_inputs
        ],
        skippedFields=[
            PollSkippedFieldResponse(name=f["name"], reason=f["reason"])
            for f in result.skipped_fields
        ],
    )


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
        inputs=body.inputs,
        target_mode=body.target_mode,
        version_id=body.version_id,
        target_workspace_id=body.target_workspace_id,
        trigger_id=body.trigger_id,
        session_bindings=body.session_bindings,
        release_source_snapshot=db.rollback,
    )
    await db.commit()
    # WF-ID is materialization-only: StartRun records the immutable logical plan
    # but neither lane receives a private/final envelope and cloud delivery does
    # not wake a sandbox. The caller next requests a fenced materialization offer.
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


@router.get(
    "/{workflow_id}/triggers/{trigger_id}/items",
    response_model=WorkflowTriggerItemListResponse,
)
async def list_trigger_items_endpoint(
    workflow_id: UUID,
    trigger_id: UUID,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowTriggerItemListResponse:
    """A poll trigger's per-item seen-set (spawned/invalid/error), newest first."""

    items = await list_trigger_items(db, user, workflow_id, trigger_id, limit=limit, offset=offset)
    return WorkflowTriggerItemListResponse(items=[trigger_item_payload(i) for i in items])
