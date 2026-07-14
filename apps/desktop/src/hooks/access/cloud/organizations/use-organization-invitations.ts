import { useQuery } from "@tanstack/react-query";
import { listOrganizationInvitations } from "@proliferate/cloud-sdk/client/organizations";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { organizationInvitationsKey } from "./query-keys";

export function useOrganizationInvitations(organizationId: string | null) {
  const cloudClient = useProductHost().cloud.client;
  return useQuery({
    queryKey: organizationInvitationsKey(organizationId),
    enabled: Boolean(organizationId) && cloudClient !== null,
    queryFn: () => listOrganizationInvitations(organizationId!, cloudClient!),
  });
}
