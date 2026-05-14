import { useQuery } from "@tanstack/react-query";
import type { OrganizationListResponse } from "@/lib/access/cloud/client";
import { listOrganizations } from "@/lib/access/cloud/organizations";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { organizationsListKey } from "./query-keys";

export function useOrganizations() {
  const { cloudActive } = useCloudAvailabilityState();

  return useQuery<OrganizationListResponse>({
    queryKey: organizationsListKey(),
    enabled: cloudActive,
    queryFn: () => listOrganizations(),
  });
}
