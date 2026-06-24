"""HTTP routes for organization integration catalog policy."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.permissions import (
    CurrentOrgUser,
    current_path_org_admin,
    current_path_org_member,
)
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
    org_user: CurrentOrgUser = Depends(current_path_org_member),
    db: AsyncSession = Depends(get_async_session),
) -> CloudOrganizationIntegrationPolicyResponse:
    try:
        snapshot = await get_organization_integration_policy(
            db,
            org_user=org_user,
        )
    except CloudApiError as error:
        return raise_cloud_error(error)
    return organization_integration_policy_payload(snapshot)


@router.patch("", response_model=CloudOrganizationIntegrationPolicyResponse)
async def patch_organization_integration_policy_endpoint(
    body: PatchCloudOrganizationIntegrationPolicyRequest,
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    db: AsyncSession = Depends(get_async_session),
) -> CloudOrganizationIntegrationPolicyResponse:
    try:
        snapshot = await patch_organization_integration_policy(
            db,
            org_admin=org_admin,
            body=body,
        )
    except CloudApiError as error:
        return raise_cloud_error(error)
    return organization_integration_policy_payload(snapshot)
