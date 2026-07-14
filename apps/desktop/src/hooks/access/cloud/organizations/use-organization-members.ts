import { useQuery } from "@tanstack/react-query";
import { listOrganizationMembers } from "@proliferate/cloud-sdk/client/organizations";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { organizationMembersKey } from "./query-keys";

export function useOrganizationMembers(organizationId: string | null) {
  const cloudClient = useProductHost().cloud.client;
  return useQuery({
    queryKey: organizationMembersKey(organizationId),
    enabled: Boolean(organizationId) && cloudClient !== null,
    queryFn: () => listOrganizationMembers(organizationId!, cloudClient!),
  });
}
