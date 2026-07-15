from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_organization_actor
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.permissions import (
    CurrentOrgUser,
    current_path_org_admin,
    current_path_org_member,
)
from proliferate.server.organizations.models import (
    OrganizationInvitationAcceptRequest,
    OrganizationInvitationAcceptResponse,
    OrganizationInvitationResponse,
    OrganizationInvitationsResponse,
    OrganizationInviteRequest,
    OrganizationJoinLinkResponse,
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
    accept_current_user_invitation,
    accept_invitation,
    create_invitation,
    get_organization,
    get_organization_join_link,
    list_current_user_invitations,
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


@router.post("/invitations/accept", response_model=OrganizationInvitationAcceptResponse)
async def accept_organization_invitation_endpoint(
    body: OrganizationInvitationAcceptRequest,
    user: User = Depends(current_organization_actor),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationInvitationAcceptResponse:
    record = await accept_invitation(
        db,
        user,
        organization_id=body.organization_id,
    )
    return OrganizationInvitationAcceptResponse(
        organization=organization_with_membership_response(record),
    )


@router.get("/invitations/current", response_model=OrganizationInvitationsResponse)
async def list_current_user_organization_invitations_endpoint(
    user: User = Depends(current_organization_actor),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationInvitationsResponse:
    invitations = await list_current_user_invitations(db, user)
    return OrganizationInvitationsResponse(
        invitations=[invitation_response(invitation) for invitation in invitations],
    )


@router.post(
    "/invitations/current/{invitation_id}/accept",
    response_model=OrganizationInvitationAcceptResponse,
)
async def accept_current_user_organization_invitation_endpoint(
    invitation_id: UUID,
    user: User = Depends(current_organization_actor),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationInvitationAcceptResponse:
    record = await accept_current_user_invitation(db, user, invitation_id)
    return OrganizationInvitationAcceptResponse(
        organization=organization_with_membership_response(record),
    )


@router.get("", response_model=OrganizationListResponse)
async def list_organizations_endpoint(
    user: User = Depends(current_organization_actor),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationListResponse:
    records = await list_organizations(db, user)
    return OrganizationListResponse(
        organizations=[organization_with_membership_response(record) for record in records],
    )


@router.get("/{organization_id}", response_model=OrganizationResponse)
async def get_organization_endpoint(
    org_user: CurrentOrgUser = Depends(current_path_org_member),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationResponse:
    record = await get_organization(db, org_user)
    return organization_with_membership_response(record)


@router.patch("/{organization_id}", response_model=OrganizationResponse)
async def update_organization_endpoint(
    body: OrganizationUpdateRequest,
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationResponse:
    record = await update_organization(
        db,
        org_admin,
        name=body.name,
        logo_image=body.logo_image,
        update_logo_image="logo_image" in body.model_fields_set,
    )
    return organization_with_membership_response(record)


@router.get("/{organization_id}/members", response_model=OrganizationMembersResponse)
async def list_organization_members_endpoint(
    org_user: CurrentOrgUser = Depends(current_path_org_member),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationMembersResponse:
    members = await list_members(db, org_user)
    return OrganizationMembersResponse(members=[member_response(member) for member in members])


@router.patch(
    "/{organization_id}/members/{membership_id}",
    response_model=OrganizationMembershipResponse,
)
async def update_organization_membership_endpoint(
    membership_id: UUID,
    body: OrganizationMembershipUpdateRequest,
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationMembershipResponse:
    membership = await update_membership(
        db,
        org_admin,
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
    membership_id: UUID,
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationMembershipResponse:
    membership = await remove_membership(db, org_admin, membership_id)
    return membership_response(membership)


@router.get("/{organization_id}/invitations", response_model=OrganizationInvitationsResponse)
async def list_organization_invitations_endpoint(
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationInvitationsResponse:
    invitations = await list_invitations(db, org_admin)
    return OrganizationInvitationsResponse(
        invitations=[invitation_response(invitation) for invitation in invitations],
    )


@router.get("/{organization_id}/join-link", response_model=OrganizationJoinLinkResponse)
async def get_organization_join_link_endpoint(
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
) -> OrganizationJoinLinkResponse:
    return OrganizationJoinLinkResponse(url=get_organization_join_link(org_admin.organization_id))


@router.post(
    "/{organization_id}/invitations",
    response_model=OrganizationInvitationResponse,
    status_code=201,
)
async def create_organization_invitation_endpoint(
    body: OrganizationInviteRequest,
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    user: User = Depends(current_organization_actor),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationInvitationResponse:
    result = await create_invitation(
        db,
        org_admin,
        inviter_email=user.email,
        email=str(body.email),
        role=body.role,
    )
    return invitation_response(result.invitation)


@router.post(
    "/{organization_id}/invitations/{invitation_id}/resend",
    response_model=OrganizationInvitationResponse,
)
async def resend_organization_invitation_endpoint(
    invitation_id: UUID,
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    user: User = Depends(current_organization_actor),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationInvitationResponse:
    result = await resend_invitation(
        db,
        org_admin,
        invitation_id,
        inviter_email=user.email,
    )
    return invitation_response(result.invitation)


@router.delete(
    "/{organization_id}/invitations/{invitation_id}",
    response_model=OrganizationInvitationResponse,
)
async def revoke_organization_invitation_endpoint(
    invitation_id: UUID,
    org_admin: CurrentOrgUser = Depends(current_path_org_admin),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationInvitationResponse:
    invitation = await revoke_invitation(db, org_admin, invitation_id)
    return invitation_response(invitation)
