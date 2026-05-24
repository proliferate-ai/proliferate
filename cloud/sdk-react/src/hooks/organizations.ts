import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  getCurrentTeam,
  listOrganizationInvitations,
  listOrganizationMembers,
  listOrganizations,
  listCurrentUserOrganizationInvitations,
  removeOrganizationMembership,
  updateOrganizationMembership,
  type OrganizationInvitationAcceptRequest,
  type OrganizationInvitationAcceptResponse,
  type OrganizationInvitationsResponse,
  type OrganizationInviteRequest,
  type OrganizationListResponse,
  type OrganizationMembersResponse,
  type OrganizationMembershipResponse,
  type OrganizationMembershipUpdateRequest,
  type OrganizationResponse,
} from "@proliferate/cloud-sdk";
import {
  currentTeamKey,
  currentUserOrganizationInvitationsKey,
  organizationInvitationsKey,
  organizationMembersKey,
  organizationsListKey,
} from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

export function useOrganizations(enabled = true) {
  const client = useCloudClient();
  return useQuery<OrganizationListResponse>({
    queryKey: organizationsListKey(),
    queryFn: () => listOrganizations(client),
    enabled,
  });
}

export function useCurrentTeam(enabled = true) {
  const client = useCloudClient();
  return useQuery<OrganizationResponse | null>({
    queryKey: currentTeamKey(),
    queryFn: () => getCurrentTeam(client),
    enabled,
  });
}

export function useOrganizationMembers(organizationId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<OrganizationMembersResponse>({
    queryKey: organizationMembersKey(organizationId),
    queryFn: () => listOrganizationMembers(organizationId!, client),
    enabled: enabled && organizationId !== null,
  });
}

export function useOrganizationInvitations(organizationId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<OrganizationInvitationsResponse>({
    queryKey: organizationInvitationsKey(organizationId),
    queryFn: () => listOrganizationInvitations(organizationId!, client),
    enabled: enabled && organizationId !== null,
  });
}

export function useCurrentUserOrganizationInvitations(enabled = true) {
  const client = useCloudClient();
  return useQuery<OrganizationInvitationsResponse>({
    queryKey: currentUserOrganizationInvitationsKey(),
    queryFn: () => listCurrentUserOrganizationInvitations(client),
    enabled,
  });
}

export function useOrganizationMutations(organizationId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: organizationsListKey() }),
      queryClient.invalidateQueries({ queryKey: currentTeamKey() }),
      queryClient.invalidateQueries({ queryKey: organizationMembersKey(organizationId) }),
      queryClient.invalidateQueries({ queryKey: organizationInvitationsKey(organizationId) }),
      queryClient.invalidateQueries({ queryKey: currentUserOrganizationInvitationsKey() }),
    ]);
  };

  const invite = useMutation<unknown, Error, OrganizationInviteRequest>({
    mutationFn: (input) => createOrganizationInvitation(organizationId!, input),
    onSuccess: invalidate,
  });
  const updateMember = useMutation<
    OrganizationMembershipResponse,
    Error,
    { membershipId: string; input: OrganizationMembershipUpdateRequest }
  >({
    mutationFn: ({ membershipId, input }) =>
      updateOrganizationMembership(organizationId!, membershipId, input),
    onSuccess: invalidate,
  });
  const removeMember = useMutation<OrganizationMembershipResponse, Error, string>({
    mutationFn: (membershipId) => removeOrganizationMembership(organizationId!, membershipId),
    onSuccess: invalidate,
  });
  return {
    inviteMember: invite.mutateAsync,
    invitingMember: invite.isPending,
    updateMember: updateMember.mutateAsync,
    updatingMember: updateMember.isPending,
    removeMember: removeMember.mutateAsync,
    removingMember: removeMember.isPending,
  };
}

export function useAcceptOrganizationInviteMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    OrganizationInvitationAcceptResponse,
    Error,
    OrganizationInvitationAcceptRequest
  >({
    mutationFn: acceptOrganizationInvitation,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: organizationsListKey() }),
        queryClient.invalidateQueries({ queryKey: currentTeamKey() }),
        queryClient.invalidateQueries({ queryKey: currentUserOrganizationInvitationsKey() }),
      ]);
    },
  });
}
