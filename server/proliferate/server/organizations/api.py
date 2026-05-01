from __future__ import annotations

from typing import NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse

from proliferate.auth.dependencies import current_active_user
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
    organization_response,
    organization_with_membership_response,
)
from proliferate.server.organizations.service import (
    OrganizationServiceError,
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


def _raise_organization_error(error: OrganizationServiceError) -> NoReturn:
    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
    ) from error


@router.get(
    "/invitations/landing",
    response_class=HTMLResponse,
    include_in_schema=False,
)
async def organization_invitation_landing(token: str) -> HTMLResponse:
    try:
        html = await create_invitation_landing_handoff(token)
    except OrganizationServiceError as error:
        _raise_organization_error(error)
    return HTMLResponse(html)


@router.post("/invitations/accept", response_model=OrganizationInvitationAcceptResponse)
async def accept_organization_invitation_endpoint(
    body: OrganizationInvitationAcceptRequest,
    user: User = Depends(current_active_user),
) -> OrganizationInvitationAcceptResponse:
    try:
        record = await accept_invitation(user, body.invite_handoff)
    except OrganizationServiceError as error:
        _raise_organization_error(error)
    return OrganizationInvitationAcceptResponse(
        organization=organization_with_membership_response(record),
    )


@router.get("", response_model=OrganizationListResponse)
async def list_organizations_endpoint(
    user: User = Depends(current_active_user),
) -> OrganizationListResponse:
    records = await list_organizations(user)
    return OrganizationListResponse(
        organizations=[organization_with_membership_response(record) for record in records],
    )


@router.get("/{organization_id}", response_model=OrganizationResponse)
async def get_organization_endpoint(
    organization_id: UUID,
    user: User = Depends(current_active_user),
) -> OrganizationResponse:
    try:
        record = await get_organization(user, organization_id)
    except OrganizationServiceError as error:
        _raise_organization_error(error)
    return organization_with_membership_response(record)


@router.patch("/{organization_id}", response_model=OrganizationResponse)
async def update_organization_endpoint(
    organization_id: UUID,
    body: OrganizationUpdateRequest,
    user: User = Depends(current_active_user),
) -> OrganizationResponse:
    try:
        organization = await update_organization(
            user,
            organization_id,
            name=body.name,
            logo_image=body.logo_image,
            update_logo_image="logo_image" in body.model_fields_set,
        )
        membership_record = await get_organization(user, organization_id)
    except OrganizationServiceError as error:
        _raise_organization_error(error)
    return organization_response(organization, membership_record.membership)


@router.get("/{organization_id}/members", response_model=OrganizationMembersResponse)
async def list_organization_members_endpoint(
    organization_id: UUID,
    user: User = Depends(current_active_user),
) -> OrganizationMembersResponse:
    try:
        members = await list_members(user, organization_id)
    except OrganizationServiceError as error:
        _raise_organization_error(error)
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
) -> OrganizationMembershipResponse:
    try:
        membership = await update_membership(
            user,
            organization_id,
            membership_id,
            role=body.role,
            status=body.status,
        )
    except OrganizationServiceError as error:
        _raise_organization_error(error)
    return membership_response(membership)


@router.delete(
    "/{organization_id}/members/{membership_id}",
    response_model=OrganizationMembershipResponse,
)
async def remove_organization_membership_endpoint(
    organization_id: UUID,
    membership_id: UUID,
    user: User = Depends(current_active_user),
) -> OrganizationMembershipResponse:
    try:
        membership = await remove_membership(user, organization_id, membership_id)
    except OrganizationServiceError as error:
        _raise_organization_error(error)
    return membership_response(membership)


@router.get("/{organization_id}/invitations", response_model=OrganizationInvitationsResponse)
async def list_organization_invitations_endpoint(
    organization_id: UUID,
    user: User = Depends(current_active_user),
) -> OrganizationInvitationsResponse:
    try:
        invitations = await list_invitations(user, organization_id)
    except OrganizationServiceError as error:
        _raise_organization_error(error)
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
) -> OrganizationInvitationResponse:
    try:
        result = await create_invitation(
            user,
            organization_id,
            email=str(body.email),
            role=body.role,
        )
    except OrganizationServiceError as error:
        _raise_organization_error(error)
    return invitation_response(result.invitation)


@router.post(
    "/{organization_id}/invitations/{invitation_id}/resend",
    response_model=OrganizationInvitationResponse,
)
async def resend_organization_invitation_endpoint(
    organization_id: UUID,
    invitation_id: UUID,
    user: User = Depends(current_active_user),
) -> OrganizationInvitationResponse:
    try:
        result = await resend_invitation(user, organization_id, invitation_id)
    except OrganizationServiceError as error:
        _raise_organization_error(error)
    return invitation_response(result.invitation)


@router.delete(
    "/{organization_id}/invitations/{invitation_id}",
    response_model=OrganizationInvitationResponse,
)
async def revoke_organization_invitation_endpoint(
    organization_id: UUID,
    invitation_id: UUID,
    user: User = Depends(current_active_user),
) -> OrganizationInvitationResponse:
    try:
        invitation = await revoke_invitation(user, organization_id, invitation_id)
    except OrganizationServiceError as error:
        _raise_organization_error(error)
    return invitation_response(invitation)
