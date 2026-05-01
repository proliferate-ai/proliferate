import { useQuery } from "@tanstack/react-query";
import { listOrganizations } from "@/lib/integrations/cloud/organizations";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { organizationsListKey } from "./query-keys";

export function useOrganizations() {
  const { cloudActive } = useCloudAvailabilityState();

  return useQuery({
    queryKey: organizationsListKey(),
    enabled: cloudActive,
    queryFn: listOrganizations,
  });
}
