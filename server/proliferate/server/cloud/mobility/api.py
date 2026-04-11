from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.mobility.models import (
    EnsureMobilityWorkspaceRequest,
    FailWorkspaceMobilityHandoffRequest,
    FinalizeWorkspaceMobilityHandoffRequest,
    MobilityHandoffSummary,
    MobilityWorkspaceDetail,
    MobilityWorkspaceSummary,
    StartWorkspaceMobilityHandoffRequest,
    UpdateWorkspaceMobilityHandoffPhaseRequest,
    WorkspaceMobilityPreflightRequest,
    WorkspaceMobilityPreflightResponse,
    handoff_summary_payload,
    mobility_workspace_detail_payload,
    mobility_workspace_summary_payload,
)
from proliferate.server.cloud.mobility.service import (
    complete_cloud_workspace_handoff_cleanup,
    ensure_cloud_workspace_mobility,
    fail_cloud_workspace_handoff,
    finalize_cloud_workspace_handoff,
    get_cloud_workspace_mobility_detail,
    heartbeat_cloud_workspace_handoff,
    list_cloud_workspace_mobility_for_user,
    preflight_cloud_workspace_handoff,
    start_cloud_workspace_handoff,
    update_cloud_workspace_handoff_phase,
)

router = APIRouter(prefix="/mobility", tags=["cloud-mobility"])


@router.get("/workspaces", response_model=list[MobilityWorkspaceSummary])
async def list_mobility_workspaces_endpoint(
    user: User = Depends(current_active_user),
) -> list[MobilityWorkspaceSummary]:
    values = await list_cloud_workspace_mobility_for_user(user.id)
    return [mobility_workspace_summary_payload(value) for value in values]


@router.post("/workspaces/ensure", response_model=MobilityWorkspaceDetail)
async def ensure_mobility_workspace_endpoint(
    body: EnsureMobilityWorkspaceRequest,
    user: User = Depends(current_active_user),
) -> MobilityWorkspaceDetail:
    try:
        value = await ensure_cloud_workspace_mobility(
            user_id=user.id,
            git_provider=body.git_provider,
            git_owner=body.git_owner,
            git_repo_name=body.git_repo_name,
            git_branch=body.git_branch,
            display_name=body.display_name,
            owner_hint=body.owner_hint,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return mobility_workspace_detail_payload(value)


@router.get("/workspaces/{mobility_workspace_id}", response_model=MobilityWorkspaceDetail)
async def get_mobility_workspace_endpoint(
    mobility_workspace_id: UUID,
    user: User = Depends(current_active_user),
) -> MobilityWorkspaceDetail:
    try:
        value = await get_cloud_workspace_mobility_detail(
            user_id=user.id,
            mobility_workspace_id=mobility_workspace_id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return mobility_workspace_detail_payload(value)


@router.post(
    "/workspaces/{mobility_workspace_id}/preflight",
    response_model=WorkspaceMobilityPreflightResponse,
)
async def preflight_mobility_handoff_endpoint(
    mobility_workspace_id: UUID,
    body: WorkspaceMobilityPreflightRequest,
    user: User = Depends(current_active_user),
) -> WorkspaceMobilityPreflightResponse:
    try:
        return await preflight_cloud_workspace_handoff(
            user_id=user.id,
            mobility_workspace_id=mobility_workspace_id,
            direction=body.direction,
            requested_branch=body.requested_branch,
            requested_base_sha=body.requested_base_sha,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post(
    "/workspaces/{mobility_workspace_id}/handoffs/start",
    response_model=MobilityHandoffSummary,
)
async def start_mobility_handoff_endpoint(
    mobility_workspace_id: UUID,
    body: StartWorkspaceMobilityHandoffRequest,
    user: User = Depends(current_active_user),
) -> MobilityHandoffSummary:
    try:
        value = await start_cloud_workspace_handoff(
            user_id=user.id,
            mobility_workspace_id=mobility_workspace_id,
            direction=body.direction,
            requested_branch=body.requested_branch,
            requested_base_sha=body.requested_base_sha,
            exclude_paths=body.exclude_paths,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return handoff_summary_payload(value)


@router.post(
    "/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/heartbeat",
    response_model=MobilityHandoffSummary,
)
async def heartbeat_mobility_handoff_endpoint(
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    user: User = Depends(current_active_user),
) -> MobilityHandoffSummary:
    try:
        value = await heartbeat_cloud_workspace_handoff(
            user_id=user.id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return handoff_summary_payload(value)


@router.post(
    "/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/phase",
    response_model=MobilityHandoffSummary,
)
async def update_mobility_handoff_phase_endpoint(
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    body: UpdateWorkspaceMobilityHandoffPhaseRequest,
    user: User = Depends(current_active_user),
) -> MobilityHandoffSummary:
    try:
        value = await update_cloud_workspace_handoff_phase(
            user_id=user.id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
            phase=body.phase,
            status_detail=body.status_detail,
            cloud_workspace_id=body.cloud_workspace_id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return handoff_summary_payload(value)


@router.post(
    "/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/finalize",
    response_model=MobilityHandoffSummary,
)
async def finalize_mobility_handoff_endpoint(
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    body: FinalizeWorkspaceMobilityHandoffRequest,
    user: User = Depends(current_active_user),
) -> MobilityHandoffSummary:
    try:
        value = await finalize_cloud_workspace_handoff(
            user_id=user.id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
            cloud_workspace_id=body.cloud_workspace_id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return handoff_summary_payload(value)


@router.post(
    "/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/cleanup-complete",
    response_model=MobilityHandoffSummary,
)
async def cleanup_mobility_handoff_endpoint(
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    user: User = Depends(current_active_user),
) -> MobilityHandoffSummary:
    try:
        value = await complete_cloud_workspace_handoff_cleanup(
            user_id=user.id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return handoff_summary_payload(value)


@router.post(
    "/workspaces/{mobility_workspace_id}/handoffs/{handoff_op_id}/fail",
    response_model=MobilityHandoffSummary,
)
async def fail_mobility_handoff_endpoint(
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    body: FailWorkspaceMobilityHandoffRequest,
    user: User = Depends(current_active_user),
) -> MobilityHandoffSummary:
    try:
        value = await fail_cloud_workspace_handoff(
            user_id=user.id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
            failure_code=body.failure_code,
            failure_detail=body.failure_detail,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return handoff_summary_payload(value)
