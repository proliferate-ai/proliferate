import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  acceptCurrentUserOrganizationInvitation,
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  removeOrganizationMembership,
  resendOrganizationInvitation,
  revokeOrganizationInvitation,
  updateOrganization,
  updateOrganizationMembership,
} from "@proliferate/cloud-sdk/client/organizations";
import type {
  OrganizationInviteRequest,
  OrganizationMembershipUpdateRequest,
  OrganizationUpdateRequest,
} from "@/lib/access/cloud/client";
import { requireHostCloudClient } from "@/lib/access/cloud/host-client";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  currentUserOrganizationInvitationsKey,
  organizationInvitationsKey,
  organizationMembersKey,
  organizationsListKey,
} from "./query-keys";

export function useOrganizationActions(organizationId: string | null) {
  const queryClient = useQueryClient();
  const cloudClient = useProductHost().cloud.client;

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
      return updateOrganization(organizationId, input, requireHostCloudClient(cloudClient));
    },
    onSuccess: invalidateOrganization,
  });

  const createInvitationMutation = useMutation({
    mutationFn: (input: OrganizationInviteRequest) => {
      if (!organizationId) throw new Error("Organization is required.");
      return createOrganizationInvitation(
        organizationId,
        input,
        requireHostCloudClient(cloudClient),
      );
    },
    onSuccess: invalidateOrganization,
  });

  const resendInvitationMutation = useMutation({
    mutationFn: (invitationId: string) => {
      if (!organizationId) throw new Error("Organization is required.");
      return resendOrganizationInvitation(
        organizationId,
        invitationId,
        requireHostCloudClient(cloudClient),
      );
    },
    onSuccess: invalidateOrganization,
  });

  const revokeInvitationMutation = useMutation({
    mutationFn: (invitationId: string) => {
      if (!organizationId) throw new Error("Organization is required.");
      return revokeOrganizationInvitation(
        organizationId,
        invitationId,
        requireHostCloudClient(cloudClient),
      );
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
      return updateOrganizationMembership(
        organizationId,
        membershipId,
        input,
        requireHostCloudClient(cloudClient),
      );
    },
    onSuccess: invalidateOrganization,
  });

  const removeMembershipMutation = useMutation({
    mutationFn: (membershipId: string) => {
      if (!organizationId) throw new Error("Organization is required.");
      return removeOrganizationMembership(
        organizationId,
        membershipId,
        requireHostCloudClient(cloudClient),
      );
    },
    onSuccess: invalidateOrganization,
  });

  const acceptInvitationMutation = useMutation({
    mutationFn: (joinOrganizationId: string) =>
      acceptOrganizationInvitation(
        { organizationId: joinOrganizationId },
        requireHostCloudClient(cloudClient),
      ),
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: organizationsListKey() }),
        queryClient.invalidateQueries({ queryKey: currentUserOrganizationInvitationsKey() }),
        queryClient.invalidateQueries({
          queryKey: organizationMembersKey(response.organization.id),
        }),
      ]);
    },
  });

  const acceptCurrentInvitationMutation = useMutation({
    mutationFn: (invitationId: string) =>
      acceptCurrentUserOrganizationInvitation(
        invitationId,
        requireHostCloudClient(cloudClient),
      ),
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: organizationsListKey() }),
        queryClient.invalidateQueries({ queryKey: currentUserOrganizationInvitationsKey() }),
        queryClient.invalidateQueries({
          queryKey: organizationMembersKey(response.organization.id),
        }),
        queryClient.invalidateQueries({
          queryKey: organizationInvitationsKey(response.organization.id),
        }),
      ]);
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
    acceptCurrentInvitation: acceptCurrentInvitationMutation.mutateAsync,
    acceptingCurrentInvitation: acceptCurrentInvitationMutation.isPending,
    acceptCurrentInvitationError: acceptCurrentInvitationMutation.error,
  };
}
