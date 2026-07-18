"""Product-user access dependencies for integration action approvals."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.integrations import action_approvals as approvals_store
from proliferate.server.cloud.errors import CloudApiError


@dataclass(frozen=True)
class ActionApprovalAccess:
    actor_user_id: UUID
    approval: approvals_store.ActionApprovalRecord


@dataclass(frozen=True)
class ActionApprovalListAccess:
    actor_user_id: UUID
    visible_organization_ids: frozenset[UUID]


async def action_approval_user_can_list(
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> ActionApprovalListAccess:
    organizations = await organizations_store.list_organizations_for_user(db, user.id)
    return ActionApprovalListAccess(
        actor_user_id=user.id,
        visible_organization_ids=frozenset(
            organization.organization.id for organization in organizations
        ),
    )


async def action_approval_user_can_manage(
    approval_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> ActionApprovalAccess:
    approval = await approvals_store.get_approval_for_user(
        db, approval_id=approval_id, user_id=user.id
    )
    if approval is None:
        raise CloudApiError(
            "integration_action_approval_not_found",
            "Integration action approval not found.",
            status_code=404,
        )
    if approval.organization_id is not None:
        membership = await organizations_store.get_active_membership(
            db,
            organization_id=approval.organization_id,
            user_id=user.id,
        )
        if membership is None:
            raise CloudApiError(
                "integration_action_approval_not_found",
                "Integration action approval not found.",
                status_code=404,
            )
    return ActionApprovalAccess(actor_user_id=user.id, approval=approval)
