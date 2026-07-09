"""Cloud workflows API routes.

Route order matters: the literal ``/runs`` sub-routes are declared before the
``/{workflow_id}`` parameter routes so ``GET /workflows/runs`` is not swallowed as
a workflow lookup with id ``"runs"``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.constants.workflows import WORKFLOW_TARGET_MODE_PERSONAL_CLOUD
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.integrations.slack import client as slack_client
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.delivery import (
    cancel_run,
    deliver_cloud_run,
    refresh_cloud_run,
)
from proliferate.server.cloud.workflows.models import (
    RunStatusRequest,
    SlackChannelResponse,
    SlackChannelsResponse,
    StartRunRequest,
    StepActionResponse,
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
    create_trigger,
    create_workflow,
    delete_trigger,
    get_run,
    get_trigger,
    get_workflow_detail,
    list_runs,
    list_trigger_items,
    list_triggers,
    list_workflows,
    mark_run_delivered,
    report_run_status,
    start_run,
    update_trigger,
    update_workflow,
)
from proliferate.utils.crypto import decrypt_json
from proliferate.utils.time import utcnow

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


@router.get("/runs/{run_id}", response_model=WorkflowRunDetailResponse)
async def get_run_endpoint(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowRunDetailResponse:
    run = await get_run(db, user, run_id)
    actions = await store.list_actions_for_run(db, run_id=run.id)
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


@router.post("/runs/{run_id}/cancel", response_model=WorkflowRunResponse)
async def cancel_run_endpoint(
    run_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowRunResponse:
    """Take over / cancel a run (D15). User auth, owner-scoped (a run the caller
    can't see 404s). This is the single human override; the UI's take-over action
    routes here, and a blocked mutating verb's 409 ``SESSION_WORKFLOW_HELD`` sends
    the user to it."""

    return run_payload(await cancel_run(db, user, run_id))


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


@dataclass(frozen=True)
class _PingActor:
    """Minimal actor for the ping-triggered refresh — the run-token proves the run,
    so the owner id is all the cloud-sandbox gateway access needs."""

    id: UUID


@router.post("/runs/{run_id}/ping", status_code=202)
async def run_ping_endpoint(
    run_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> Response:
    """Completion ping (L16 / §3.7). NO user-session auth — the per-run gateway
    token IS the auth. The runtime fires this after each step transition; the
    handler validates the token, requires token↔run_id match (so run A's token
    can't ping run B), and wakes the existing refresh path for cloud-lane runs.

    The body carries nothing: it is a stateless nudge. Duplicate/stale/late pings
    are safe by construction — refresh is reconcile-shaped and run-status
    transitions are monotonic — so no state is added here.
    """

    header = request.headers.get("authorization", "")
    scheme, _, raw = header.partition(" ")
    token = raw.strip()
    if scheme.lower() != "bearer" or not token:
        raise CloudApiError(
            "workflow_ping_unauthorized",
            "Missing or malformed run ping token.",
            status_code=401,
        )
    grant = await store.get_active_run_gateway_token_by_hash(
        db,
        token_hash=runtime_workers_store.hash_workflow_run_gateway_token(token),
        now=utcnow(),
    )
    if grant is None:
        # Unknown, expired (terminal run), or revoked token.
        raise CloudApiError(
            "workflow_ping_unauthorized",
            "Run ping token is invalid, expired, or revoked.",
            status_code=401,
        )
    if grant.workflow_run_id != run_id:
        raise CloudApiError(
            "workflow_ping_run_mismatch",
            "This token does not belong to the pinged run.",
            status_code=403,
        )

    run = await store.get_run(db, run_id)
    # Local-lane runs are observed by the desktop relay, which owns local
    # observation; the ping is accepted (202) and no-ops the refresh here.
    if run is not None and run.target_mode == WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
        try:
            await refresh_cloud_run(db, _PingActor(id=grant.owner_user_id), run)
        except CloudApiError:
            # A failed refresh never changes engine state — the ping is a nudge,
            # not a transition; the scheduler phase-3 sweep remains the backstop.
            pass
    return Response(status_code=202)


@router.get("/slack/channels", response_model=SlackChannelsResponse)
async def list_slack_channels_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> SlackChannelsResponse:
    account_pair = await accounts_store.get_ready_account_for_provider(db, user.id, "slack")
    if account_pair is None:
        return SlackChannelsResponse(channels=[], connected=False)
    account, _definition = account_pair
    try:
        bundle = decrypt_json(account.credential_ciphertext)
    except Exception:
        return SlackChannelsResponse(channels=[], connected=False)
    bot_token = bundle.get("bot_token") or bundle.get("access_token")
    if not bot_token:
        return SlackChannelsResponse(channels=[], connected=False)
    try:
        channels = await slack_client.list_channels(bot_token=bot_token)
    except Exception:
        return SlackChannelsResponse(channels=[], connected=True)
    return SlackChannelsResponse(
        channels=[SlackChannelResponse(id=c.id, name=c.name) for c in channels],
        connected=True,
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
