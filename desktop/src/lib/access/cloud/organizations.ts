import { getProliferateClient } from "./client";
import type {
  OrganizationInvitationAcceptRequest,
  OrganizationInvitationAcceptResponse,
  OrganizationInvitationResponse,
  OrganizationInvitationsResponse,
  OrganizationInviteRequest,
  OrganizationListResponse,
  OrganizationMembersResponse,
  OrganizationMembershipResponse,
  OrganizationMembershipUpdateRequest,
  OrganizationResponse,
  OrganizationUpdateRequest,
} from "./client";

export async function listOrganizations(): Promise<OrganizationListResponse> {
  return (await getProliferateClient().GET("/v1/organizations")).data!;
}

export async function updateOrganization(
  organizationId: string,
  input: OrganizationUpdateRequest,
): Promise<OrganizationResponse> {
  return (
    await getProliferateClient().PATCH("/v1/organizations/{organization_id}", {
      params: { path: { organization_id: organizationId } },
      body: input,
    })
  ).data!;
}

export async function listOrganizationMembers(
  organizationId: string,
): Promise<OrganizationMembersResponse> {
  return (
    await getProliferateClient().GET("/v1/organizations/{organization_id}/members", {
      params: { path: { organization_id: organizationId } },
    })
  ).data!;
}

export async function updateOrganizationMembership(
  organizationId: string,
  membershipId: string,
  input: OrganizationMembershipUpdateRequest,
): Promise<OrganizationMembershipResponse> {
  return (
    await getProliferateClient().PATCH(
      "/v1/organizations/{organization_id}/members/{membership_id}",
      {
        params: { path: { organization_id: organizationId, membership_id: membershipId } },
        body: input,
      },
    )
  ).data!;
}

export async function removeOrganizationMembership(
  organizationId: string,
  membershipId: string,
): Promise<OrganizationMembershipResponse> {
  return (
    await getProliferateClient().DELETE(
      "/v1/organizations/{organization_id}/members/{membership_id}",
      {
        params: { path: { organization_id: organizationId, membership_id: membershipId } },
      },
    )
  ).data!;
}

export async function listOrganizationInvitations(
  organizationId: string,
): Promise<OrganizationInvitationsResponse> {
  return (
    await getProliferateClient().GET("/v1/organizations/{organization_id}/invitations", {
      params: { path: { organization_id: organizationId } },
    })
  ).data!;
}

export async function createOrganizationInvitation(
  organizationId: string,
  input: OrganizationInviteRequest,
): Promise<OrganizationInvitationResponse> {
  return (
    await getProliferateClient().POST("/v1/organizations/{organization_id}/invitations", {
      params: { path: { organization_id: organizationId } },
      body: input,
    })
  ).data!;
}

export async function resendOrganizationInvitation(
  organizationId: string,
  invitationId: string,
): Promise<OrganizationInvitationResponse> {
  return (
    await getProliferateClient().POST(
      "/v1/organizations/{organization_id}/invitations/{invitation_id}/resend",
      {
        params: { path: { organization_id: organizationId, invitation_id: invitationId } },
      },
    )
  ).data!;
}

export async function revokeOrganizationInvitation(
  organizationId: string,
  invitationId: string,
): Promise<OrganizationInvitationResponse> {
  return (
    await getProliferateClient().DELETE(
      "/v1/organizations/{organization_id}/invitations/{invitation_id}",
      {
        params: { path: { organization_id: organizationId, invitation_id: invitationId } },
      },
    )
  ).data!;
}

export async function acceptOrganizationInvitation(
  input: OrganizationInvitationAcceptRequest,
): Promise<OrganizationInvitationAcceptResponse> {
  return (
    await getProliferateClient().POST("/v1/organizations/invitations/accept", {
      body: input,
    })
  ).data!;
}
