import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/collections";
import { buildWorkspaceCollections } from "@/lib/domain/workspaces/collections";
import { listCloudWorkspaces } from "@/lib/integrations/cloud/workspaces";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { workspaceCollectionsKey } from "./query-keys";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";

export function useWorkspaces() {
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const connectionState = useHarnessStore((state) => state.connectionState);
  const { cloudActive } = useCloudAvailabilityState();
  const isHealthy = connectionState === "healthy" && runtimeUrl.trim().length > 0;

  return useQuery<WorkspaceCollections>({
    queryKey: workspaceCollectionsKey(runtimeUrl, cloudActive),
    queryFn: async () => {
      const startedAt = startLatencyTimer();
      logLatency("workspace.collections.fetch.start", {
        runtimeUrl,
        cloudActive,
      });
      const localWorkspaces = await getAnyHarnessClient({ runtimeUrl }).workspaces.list("code").catch(() => []);
      const cloudWorkspaces = cloudActive
        ? await listCloudWorkspaces().catch(() => null)
        : [];

      const collections = buildWorkspaceCollections(localWorkspaces, cloudWorkspaces ?? []);
      logLatency("workspace.collections.fetch.success", {
        runtimeUrl,
        cloudActive,
        localCount: collections.localWorkspaces.length,
        cloudCount: collections.cloudWorkspaces.length,
        mergedCount: collections.workspaces.length,
        elapsedMs: elapsedMs(startedAt),
      });
      return collections;
    },
    enabled: isHealthy,
  });
}
