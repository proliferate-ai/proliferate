"""HTTP routes for organization integration catalog policy."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.integration_policy.models import (
    CloudOrganizationIntegrationPolicyResponse,
    PatchCloudOrganizationIntegrationPolicyRequest,
    organization_integration_policy_payload,
)
from proliferate.server.cloud.integration_policy.service import (
    get_organization_integration_policy,
    patch_organization_integration_policy,
)

router = APIRouter(prefix="/organizations/{organization_id}/integration-policy")


@router.get("", response_model=CloudOrganizationIntegrationPolicyResponse)
async def get_organization_integration_policy_endpoint(
    organization_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudOrganizationIntegrationPolicyResponse:
    try:
        snapshot = await get_organization_integration_policy(
            db,
            actor_user_id=user.id,
            organization_id=organization_id,
        )
    except CloudApiError as error:
        return raise_cloud_error(error)
    return organization_integration_policy_payload(snapshot)


@router.patch("", response_model=CloudOrganizationIntegrationPolicyResponse)
async def patch_organization_integration_policy_endpoint(
    organization_id: UUID,
    body: PatchCloudOrganizationIntegrationPolicyRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudOrganizationIntegrationPolicyResponse:
    try:
        snapshot = await patch_organization_integration_policy(
            db,
            actor_user_id=user.id,
            organization_id=organization_id,
            body=body,
        )
    except CloudApiError as error:
        return raise_cloud_error(error)
    return organization_integration_policy_payload(snapshot)
