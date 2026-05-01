import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  removeOrganizationMembership,
  resendOrganizationInvitation,
  revokeOrganizationInvitation,
  updateOrganization,
  updateOrganizationMembership,
} from "@/lib/integrations/cloud/organizations";
import type {
  OrganizationInviteRequest,
  OrganizationMembershipUpdateRequest,
  OrganizationUpdateRequest,
} from "@/lib/integrations/cloud/client";
import {
  organizationInvitationsKey,
  organizationMembersKey,
  organizationsListKey,
} from "./query-keys";

export function useOrganizationActions(organizationId: string | null) {
  const queryClient = useQueryClient();

  async function invalidateOrganization() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: organizationsListKey() }),
      queryClient.invalidateQueries({ queryKey: organizationMembersKey(organizationId) }),
      queryClient.invalidateQueries({ queryKey: organizationInvitationsKey(organizationId) }),
    ]);
  }

  const updateOrganizationMutation = useMutation({
    mutationFn: (input: OrganizationUpdateRequest) => {
      if (!organizationId) throw new Error("Organization is required.");
      return updateOrganization(organizationId, input);
    },
    onSuccess: invalidateOrganization,
  });

  const createInvitationMutation = useMutation({
    mutationFn: (input: OrganizationInviteRequest) => {
      if (!organizationId) throw new Error("Organization is required.");
      return createOrganizationInvitation(organizationId, input);
    },
    onSuccess: invalidateOrganization,
  });

  const resendInvitationMutation = useMutation({
    mutationFn: (invitationId: string) => {
      if (!organizationId) throw new Error("Organization is required.");
      return resendOrganizationInvitation(organizationId, invitationId);
    },
    onSuccess: invalidateOrganization,
  });

  const revokeInvitationMutation = useMutation({
    mutationFn: (invitationId: string) => {
      if (!organizationId) throw new Error("Organization is required.");
      return revokeOrganizationInvitation(organizationId, invitationId);
    },
    onSuccess: invalidateOrganization,
  });

  const updateMembershipMutation = useMutation({
    mutationFn: ({
      membershipId,
      input,
    }: {
      membershipId: string;
      input: OrganizationMembershipUpdateRequest;
    }) => {
      if (!organizationId) throw new Error("Organization is required.");
      return updateOrganizationMembership(organizationId, membershipId, input);
    },
    onSuccess: invalidateOrganization,
  });

  const removeMembershipMutation = useMutation({
    mutationFn: (membershipId: string) => {
      if (!organizationId) throw new Error("Organization is required.");
      return removeOrganizationMembership(organizationId, membershipId);
    },
    onSuccess: invalidateOrganization,
  });

  const acceptInvitationMutation = useMutation({
    mutationFn: (inviteHandoff: string) => acceptOrganizationInvitation({ inviteHandoff }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: organizationsListKey() });
    },
  });

  return {
    updateOrganization: updateOrganizationMutation.mutateAsync,
    updatingOrganization: updateOrganizationMutation.isPending,
    createInvitation: createInvitationMutation.mutateAsync,
    creatingInvitation: createInvitationMutation.isPending,
    resendInvitation: resendInvitationMutation.mutateAsync,
    resendingInvitation: resendInvitationMutation.isPending,
    revokeInvitation: revokeInvitationMutation.mutateAsync,
    revokingInvitation: revokeInvitationMutation.isPending,
    updateMembership: updateMembershipMutation.mutateAsync,
    updatingMembership: updateMembershipMutation.isPending,
    removeMembership: removeMembershipMutation.mutateAsync,
    removingMembership: removeMembershipMutation.isPending,
    acceptInvitation: acceptInvitationMutation.mutateAsync,
    acceptingInvitation: acceptInvitationMutation.isPending,
    acceptInvitationError: acceptInvitationMutation.error,
  };
}
