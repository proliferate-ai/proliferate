"""HTTP routes for org-owned sandbox profiles.

Create is org-admin gated; list is member-visible.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Path
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.permissions import CurrentOrgUser, current_path_org_admin, current_path_org_member
from proliferate.server.cloud.org_sandbox_profiles.models import (
    CreateOrgSandboxProfileRequest,
    OrgSandboxProfileListResponse,
    OrgSandboxProfileResponse,
    org_sandbox_profile_payload,
)
from proliferate.server.cloud.org_sandbox_profiles.service import (
    create_org_sandbox_profile,
    get_org_sandbox_profile,
    list_org_sandbox_profiles,
)

router = APIRouter(
    prefix="/organizations/{organization_id}/sandbox-profiles",
    tags=["org-sandbox-profiles"],
)


@router.get("", response_model=OrgSandboxProfileListResponse)
async def list_org_sandbox_profiles_endpoint(
    organization_id: UUID = Path(...),
    org_user: CurrentOrgUser = Depends(current_path_org_member),
    db: AsyncSession = Depends(get_async_session),
) -> OrgSandboxProfileListResponse:
    profiles = await list_org_sandbox_profiles(db, organization_id=organization_id)
    return OrgSandboxProfileListResponse(
        profiles=[org_sandbox_profile_payload(p) for p in profiles],
    )


@router.post("", response_model=OrgSandboxProfileResponse, status_code=201)
async def create_org_sandbox_profile_endpoint(
    body: CreateOrgSandboxProfileRequest,
    organization_id: UUID = Path(...),
    org_user: CurrentOrgUser = Depends(current_path_org_admin),
    db: AsyncSession = Depends(get_async_session),
) -> OrgSandboxProfileResponse:
    sandbox = await create_org_sandbox_profile(
        db,
        organization_id=organization_id,
        created_by_user_id=org_user.actor_user_id,
        display_name=body.display_name,
    )
    return org_sandbox_profile_payload(sandbox)


@router.get("/{sandbox_id}", response_model=OrgSandboxProfileResponse)
async def get_org_sandbox_profile_endpoint(
    organization_id: UUID = Path(...),
    sandbox_id: UUID = Path(...),
    org_user: CurrentOrgUser = Depends(current_path_org_member),
    db: AsyncSession = Depends(get_async_session),
) -> OrgSandboxProfileResponse:
    sandbox = await get_org_sandbox_profile(
        db, organization_id=organization_id, sandbox_id=sandbox_id
    )
    return org_sandbox_profile_payload(sandbox)
