import { useQuery } from "@tanstack/react-query";
import type { CloudMobilityWorkspaceDetail } from "@/lib/integrations/cloud/client";
import { getCloudMobilityWorkspaceDetail } from "@/lib/integrations/cloud/mobility";
import { useCloudAvailabilityState } from "./use-cloud-availability-state";
import { cloudMobilityWorkspaceKey } from "./query-keys";

export function useCloudMobilityWorkspaceDetail(
  mobilityWorkspaceId: string | null,
  enabled = true,
) {
  const { cloudActive } = useCloudAvailabilityState();

  return useQuery<CloudMobilityWorkspaceDetail>({
    queryKey: cloudMobilityWorkspaceKey(mobilityWorkspaceId ?? ""),
    enabled: cloudActive && enabled && mobilityWorkspaceId !== null,
    queryFn: () => getCloudMobilityWorkspaceDetail(mobilityWorkspaceId ?? ""),
  });
}
