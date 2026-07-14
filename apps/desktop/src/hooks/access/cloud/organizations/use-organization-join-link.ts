import { useQuery } from "@tanstack/react-query";
import { getOrganizationJoinLink } from "@proliferate/cloud-sdk/client/organizations";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { organizationJoinLinkKey } from "./query-keys";

export function useOrganizationJoinLink(
  organizationId: string | null,
  enabled = true,
) {
  const cloudClient = useProductHost().cloud.client;
  return useQuery({
    queryKey: organizationJoinLinkKey(organizationId),
    enabled: enabled && Boolean(organizationId) && cloudClient !== null,
    queryFn: () => getOrganizationJoinLink(organizationId!, cloudClient!),
  });
}
