import { useQuery } from "@tanstack/react-query";
import type { OrganizationListResponse } from "@/lib/access/cloud/client";
import { listOrganizations } from "@proliferate/cloud-sdk/client/organizations";
import { organizationsListKey } from "./query-keys";

export function useOrganizations() {
  return useQuery<OrganizationListResponse>({
    queryKey: organizationsListKey(),
    queryFn: () => listOrganizations(),
  });
}
