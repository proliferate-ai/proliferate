"""Cloud workspace claim access helpers."""

from __future__ import annotations

from typing import NoReturn
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import PolicyDenied
from proliferate.db.store.cloud_claims import claims as claims_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.organizations import get_active_membership
from proliferate.server.cloud.claims.domain.policy import (
    can_archive_cloud_workspace,
    can_interact_cloud_workspace,
    can_view_cloud_workspace,
    is_org_admin_role,
)
from proliferate.server.cloud.errors import CloudApiError


def raise_policy_denied(verdict: PolicyDenied) -> NoReturn:
    raise CloudApiError(verdict.code, verdict.message, status_code=verdict.status_code)


async def load_workspace_exposure_and_claim(
    db: AsyncSession,
    *,
    target_id: UUID | None,
    cloud_workspace_id: UUID,
) -> tuple[
    exposures_store.CloudWorkspaceExposureSnapshot | None,
    claims_store.CloudWorkspaceClaimSnapshot | None,
]:
    exposure = None
    if target_id is not None:
        exposure = await exposures_store.get_active_workspace_exposure(
            db,
            target_id=target_id,
            cloud_workspace_id=cloud_workspace_id,
        )
    claim = await claims_store.get_claim_for_workspace(db, cloud_workspace_id)
    return exposure, claim


async def membership_role(
    db: AsyncSession,
    *,
    organization_id: UUID | None,
    user_id: UUID,
) -> str | None:
    if organization_id is None:
        return None
    membership = await get_active_membership(
        db,
        organization_id=organization_id,
        user_id=user_id,
    )
    return membership.role if membership is not None else None


async def require_workspace_view(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    exposure: exposures_store.CloudWorkspaceExposureSnapshot | None,
) -> None:
    role = await membership_role(db, organization_id=organization_id, user_id=actor_user_id)
    verdict = can_view_cloud_workspace(
        actor_user_id=actor_user_id,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        exposure_visibility=exposure.visibility if exposure else None,
        exposure_claimed_by_user_id=exposure.claimed_by_user_id if exposure else None,
        has_active_organization_membership=role is not None,
        is_organization_admin=is_org_admin_role(role),
    )
    if isinstance(verdict, PolicyDenied):
        raise_policy_denied(verdict)


async def require_workspace_interact(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    workspace_archived: bool,
    exposure: exposures_store.CloudWorkspaceExposureSnapshot | None,
) -> None:
    role = await membership_role(db, organization_id=organization_id, user_id=actor_user_id)
    verdict = can_interact_cloud_workspace(
        actor_user_id=actor_user_id,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        exposure_visibility=exposure.visibility if exposure else None,
        exposure_claimed_by_user_id=exposure.claimed_by_user_id if exposure else None,
        workspace_archived=workspace_archived,
        has_active_organization_membership=role is not None,
    )
    if isinstance(verdict, PolicyDenied):
        raise_policy_denied(verdict)


async def require_workspace_archive(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    workspace_archived: bool,
    exposure: exposures_store.CloudWorkspaceExposureSnapshot | None,
) -> None:
    role = await membership_role(db, organization_id=organization_id, user_id=actor_user_id)
    verdict = can_archive_cloud_workspace(
        actor_user_id=actor_user_id,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        exposure_visibility=exposure.visibility if exposure else None,
        exposure_claimed_by_user_id=exposure.claimed_by_user_id if exposure else None,
        workspace_archived=workspace_archived,
        has_active_organization_membership=role is not None,
        is_organization_admin=is_org_admin_role(role),
    )
    if isinstance(verdict, PolicyDenied):
        raise_policy_denied(verdict)
