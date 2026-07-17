"""Product-authenticated API for integration external-action approvals."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import session_ops
from proliferate.db.engine import get_async_session
from proliferate.server.cloud.integrations.action_approvals.access import (
    ActionApprovalAccess,
    ActionApprovalListAccess,
    action_approval_user_can_list,
    action_approval_user_can_manage,
)
from proliferate.server.cloud.integrations.action_approvals.models import (
    ActionApprovalListResponse,
    ActionApprovalResponse,
    ActionApprovalTransitionResponse,
    ApprovalStatus,
    action_approval_response,
    action_approval_transition_response,
)
from proliferate.server.cloud.integrations.action_approvals.service import (
    list_action_approvals,
    refresh_action_approval,
    transition_action_approval,
)

router = APIRouter(prefix="/integrations/action-approvals", tags=["integration-approvals"])


@router.get("", response_model=ActionApprovalListResponse)
async def list_action_approvals_endpoint(
    status: ApprovalStatus | None = Query(default=None),
    access: ActionApprovalListAccess = Depends(action_approval_user_can_list),
    db: AsyncSession = Depends(get_async_session),
) -> ActionApprovalListResponse:
    items = await list_action_approvals(
        db,
        user_id=access.actor_user_id,
        visible_organization_ids=access.visible_organization_ids,
        status=status,
    )
    return ActionApprovalListResponse(items=[action_approval_response(item) for item in items])


@router.get("/{approval_id}", response_model=ActionApprovalResponse)
async def get_action_approval_endpoint(
    access: ActionApprovalAccess = Depends(action_approval_user_can_manage),
    db: AsyncSession = Depends(get_async_session),
) -> ActionApprovalResponse:
    approval = await refresh_action_approval(db, access=access)
    return action_approval_response(approval)


async def _transition(
    db: AsyncSession,
    *,
    access: ActionApprovalAccess,
    decision: Literal["approve", "reject", "revoke"],
) -> ActionApprovalTransitionResponse:
    transition = await transition_action_approval(db, access=access, decision=decision)
    # The product decision and its audit event are durable before the client is
    # told it may retry the external action.
    await session_ops.commit_session(db)
    return action_approval_transition_response(transition)


@router.post("/{approval_id}/approve", response_model=ActionApprovalTransitionResponse)
async def approve_action_approval_endpoint(
    access: ActionApprovalAccess = Depends(action_approval_user_can_manage),
    db: AsyncSession = Depends(get_async_session),
) -> ActionApprovalTransitionResponse:
    return await _transition(db, access=access, decision="approve")


@router.post("/{approval_id}/reject", response_model=ActionApprovalTransitionResponse)
async def reject_action_approval_endpoint(
    access: ActionApprovalAccess = Depends(action_approval_user_can_manage),
    db: AsyncSession = Depends(get_async_session),
) -> ActionApprovalTransitionResponse:
    return await _transition(db, access=access, decision="reject")


@router.post("/{approval_id}/revoke", response_model=ActionApprovalTransitionResponse)
async def revoke_action_approval_endpoint(
    access: ActionApprovalAccess = Depends(action_approval_user_can_manage),
    db: AsyncSession = Depends(get_async_session),
) -> ActionApprovalTransitionResponse:
    return await _transition(db, access=access, decision="revoke")
