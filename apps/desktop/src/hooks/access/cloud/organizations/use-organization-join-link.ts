import { useQuery } from "@tanstack/react-query";
import { getOrganizationJoinLink } from "@proliferate/cloud-sdk/client/organizations";
import { organizationJoinLinkKey } from "./query-keys";

export function useOrganizationJoinLink(
  organizationId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: organizationJoinLinkKey(organizationId),
    enabled: enabled && Boolean(organizationId),
    queryFn: () => getOrganizationJoinLink(organizationId!),
  });
}
