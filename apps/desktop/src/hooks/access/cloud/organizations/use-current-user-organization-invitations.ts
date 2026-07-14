import { useQuery } from "@tanstack/react-query";
import { listCurrentUserOrganizationInvitations } from "@proliferate/cloud-sdk/client/organizations";
import type { OrganizationInvitationsResponse } from "@/lib/access/cloud/client";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { currentUserOrganizationInvitationsKey } from "./query-keys";

export function useCurrentUserOrganizationInvitations(enabled = true) {
  const host = useProductHost();
  const authState = host.auth.state;
  const cloudClient = host.cloud.client;
  const authStatus = authState.status;
  const authUserId = authState.status === "authenticated"
    ? authState.user?.id ?? null
    : null;
  return useQuery<OrganizationInvitationsResponse>({
    queryKey: [...currentUserOrganizationInvitationsKey(), authUserId],
    enabled:
      enabled
      && authStatus === "authenticated"
      && authUserId !== null
      && cloudClient !== null,
    queryFn: () => listCurrentUserOrganizationInvitations(cloudClient!),
  });
}
