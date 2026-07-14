import { getProliferateClient, type ProliferateCloudClient } from "./core.js";
import type {
  OrganizationInvitationAcceptRequest,
  OrganizationInvitationAcceptResponse,
  OrganizationInvitationResponse,
  OrganizationInvitationsResponse,
  OrganizationInviteRequest,
  OrganizationJoinLinkResponse,
  OrganizationListResponse,
  OrganizationMembersResponse,
  OrganizationMembershipResponse,
  OrganizationMembershipUpdateRequest,
  OrganizationResponse,
  OrganizationUpdateRequest,
} from "../types/index.js";

export async function listOrganizations(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationListResponse> {
  return (await client.GET("/v1/organizations")).data! as OrganizationListResponse;
}

export async function getCurrentTeam(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationResponse | null> {
  const response = await listOrganizations(client);
  return response.organizations[0] ?? null;
}

export async function updateOrganization(
  organizationId: string,
  input: OrganizationUpdateRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationResponse> {
  return (
    await client.PATCH("/v1/organizations/{organization_id}", {
      params: { path: { organization_id: organizationId } },
      body: input,
    })
  ).data! as OrganizationResponse;
}

export async function listOrganizationMembers(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationMembersResponse> {
  return (
    await client.GET("/v1/organizations/{organization_id}/members", {
      params: { path: { organization_id: organizationId } },
    })
  ).data!;
}

export async function updateOrganizationMembership(
  organizationId: string,
  membershipId: string,
  input: OrganizationMembershipUpdateRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationMembershipResponse> {
  return (
    await client.PATCH(
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
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationMembershipResponse> {
  return (
    await client.DELETE(
      "/v1/organizations/{organization_id}/members/{membership_id}",
      {
        params: { path: { organization_id: organizationId, membership_id: membershipId } },
      },
    )
  ).data!;
}

export async function listOrganizationInvitations(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationInvitationsResponse> {
  return (
    await client.GET("/v1/organizations/{organization_id}/invitations", {
      params: { path: { organization_id: organizationId } },
    })
  ).data!;
}

export async function getOrganizationJoinLink(
  organizationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationJoinLinkResponse> {
  return (
    await client.GET("/v1/organizations/{organization_id}/join-link", {
      params: { path: { organization_id: organizationId } },
    })
  ).data!;
}

export async function listCurrentUserOrganizationInvitations(
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationInvitationsResponse> {
  return (await client.GET("/v1/organizations/invitations/current")).data!;
}

export async function acceptCurrentUserOrganizationInvitation(
  invitationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationInvitationAcceptResponse> {
  return (
    await client.POST(
      "/v1/organizations/invitations/current/{invitation_id}/accept",
      {
        params: { path: { invitation_id: invitationId } },
      },
    )
  ).data!;
}

export async function createOrganizationInvitation(
  organizationId: string,
  input: OrganizationInviteRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationInvitationResponse> {
  return (
    await client.POST("/v1/organizations/{organization_id}/invitations", {
      params: { path: { organization_id: organizationId } },
      body: input,
    })
  ).data!;
}

export async function resendOrganizationInvitation(
  organizationId: string,
  invitationId: string,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationInvitationResponse> {
  return (
    await client.POST(
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
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationInvitationResponse> {
  return (
    await client.DELETE(
      "/v1/organizations/{organization_id}/invitations/{invitation_id}",
      {
        params: { path: { organization_id: organizationId, invitation_id: invitationId } },
      },
    )
  ).data!;
}

export async function acceptOrganizationInvitation(
  input: OrganizationInvitationAcceptRequest,
  client: ProliferateCloudClient = getProliferateClient(),
): Promise<OrganizationInvitationAcceptResponse> {
  return (
    await client.POST("/v1/organizations/invitations/accept", {
      body: input,
    })
  ).data!;
}
