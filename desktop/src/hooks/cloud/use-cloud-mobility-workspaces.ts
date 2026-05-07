import { useQuery } from "@tanstack/react-query";
import type { CloudMobilityWorkspaceSummary } from "@/lib/access/cloud/client";
import { listCloudMobilityWorkspaces } from "@/lib/access/cloud/mobility";
import { useCloudAvailabilityState } from "./use-cloud-availability-state";
import { cloudMobilityWorkspacesKey } from "@/hooks/access/cloud/query-keys";

const EMPTY_CLOUD_MOBILITY_WORKSPACES: CloudMobilityWorkspaceSummary[] = [];

export function useCloudMobilityWorkspaces() {
  const { cloudActive } = useCloudAvailabilityState();

  return useQuery<CloudMobilityWorkspaceSummary[]>({
    queryKey: cloudMobilityWorkspacesKey(),
    enabled: cloudActive,
    placeholderData: EMPTY_CLOUD_MOBILITY_WORKSPACES,
    queryFn: listCloudMobilityWorkspaces,
  });
}
