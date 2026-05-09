from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.organizations.models import (
    OrganizationInvitationAcceptRequest,
    OrganizationInvitationAcceptResponse,
    OrganizationInvitationResponse,
    OrganizationInvitationsResponse,
    OrganizationInviteRequest,
    OrganizationListResponse,
    OrganizationMembershipResponse,
    OrganizationMembershipUpdateRequest,
    OrganizationMembersResponse,
    OrganizationResponse,
    OrganizationUpdateRequest,
    invitation_response,
    member_response,
    membership_response,
    organization_with_membership_response,
)
from proliferate.server.organizations.service import (
    accept_invitation,
    create_invitation,
    create_invitation_landing_handoff,
    get_organization,
    list_invitations,
    list_members,
    list_organizations,
    remove_membership,
    resend_invitation,
    revoke_invitation,
    update_membership,
    update_organization,
)

router = APIRouter(prefix="/organizations", tags=["organizations"])


@router.get(
    "/invitations/landing",
    response_class=HTMLResponse,
    include_in_schema=False,
)
async def organization_invitation_landing(
    token: str,
    db: AsyncSession = Depends(get_async_session),
) -> HTMLResponse:
    html = await create_invitation_landing_handoff(db, token)
    return HTMLResponse(html)


@router.post("/invitations/accept", response_model=OrganizationInvitationAcceptResponse)
async def accept_organization_invitation_endpoint(
    body: OrganizationInvitationAcceptRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationInvitationAcceptResponse:
    record = await accept_invitation(db, user, body.invite_handoff)
    return OrganizationInvitationAcceptResponse(
        organization=organization_with_membership_response(record),
    )


@router.get("", response_model=OrganizationListResponse)
async def list_organizations_endpoint(
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationListResponse:
    records = await list_organizations(db, user)
    return OrganizationListResponse(
        organizations=[organization_with_membership_response(record) for record in records],
    )


@router.get("/{organization_id}", response_model=OrganizationResponse)
async def get_organization_endpoint(
    organization_id: UUID,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationResponse:
    record = await get_organization(db, user, organization_id)
    return organization_with_membership_response(record)


@router.patch("/{organization_id}", response_model=OrganizationResponse)
async def update_organization_endpoint(
    organization_id: UUID,
    body: OrganizationUpdateRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationResponse:
    record = await update_organization(
        db,
        user,
        organization_id,
        name=body.name,
        logo_image=body.logo_image,
        update_logo_image="logo_image" in body.model_fields_set,
    )
    return organization_with_membership_response(record)


@router.get("/{organization_id}/members", response_model=OrganizationMembersResponse)
async def list_organization_members_endpoint(
    organization_id: UUID,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationMembersResponse:
    members = await list_members(db, user, organization_id)
    return OrganizationMembersResponse(members=[member_response(member) for member in members])


@router.patch(
    "/{organization_id}/members/{membership_id}",
    response_model=OrganizationMembershipResponse,
)
async def update_organization_membership_endpoint(
    organization_id: UUID,
    membership_id: UUID,
    body: OrganizationMembershipUpdateRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationMembershipResponse:
    membership = await update_membership(
        db,
        user,
        organization_id,
        membership_id,
        role=body.role,
        status=body.status,
    )
    return membership_response(membership)


@router.delete(
    "/{organization_id}/members/{membership_id}",
    response_model=OrganizationMembershipResponse,
)
async def remove_organization_membership_endpoint(
    organization_id: UUID,
    membership_id: UUID,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationMembershipResponse:
    membership = await remove_membership(db, user, organization_id, membership_id)
    return membership_response(membership)


@router.get("/{organization_id}/invitations", response_model=OrganizationInvitationsResponse)
async def list_organization_invitations_endpoint(
    organization_id: UUID,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationInvitationsResponse:
    invitations = await list_invitations(db, user, organization_id)
    return OrganizationInvitationsResponse(
        invitations=[invitation_response(invitation) for invitation in invitations],
    )


@router.post(
    "/{organization_id}/invitations",
    response_model=OrganizationInvitationResponse,
    status_code=201,
)
async def create_organization_invitation_endpoint(
    organization_id: UUID,
    body: OrganizationInviteRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationInvitationResponse:
    result = await create_invitation(
        db,
        user,
        organization_id,
        email=str(body.email),
        role=body.role,
    )
    return invitation_response(result.invitation)


@router.post(
    "/{organization_id}/invitations/{invitation_id}/resend",
    response_model=OrganizationInvitationResponse,
)
async def resend_organization_invitation_endpoint(
    organization_id: UUID,
    invitation_id: UUID,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationInvitationResponse:
    result = await resend_invitation(db, user, organization_id, invitation_id)
    return invitation_response(result.invitation)


@router.delete(
    "/{organization_id}/invitations/{invitation_id}",
    response_model=OrganizationInvitationResponse,
)
async def revoke_organization_invitation_endpoint(
    organization_id: UUID,
    invitation_id: UUID,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationInvitationResponse:
    invitation = await revoke_invitation(db, user, organization_id, invitation_id)
    return invitation_response(invitation)
