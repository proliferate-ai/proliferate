import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceCollections } from "@/lib/domain/workspaces/collections";
import {
  buildWorkspaceCollections,
  workspaceCollectionsNeedActivityRefresh,
} from "@/lib/domain/workspaces/collections";
import { listCloudWorkspaces } from "@/lib/integrations/cloud/workspaces";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { workspaceCollectionsKey } from "./query-keys";
import {
  elapsedMs,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/debug-latency";

const WORKSPACE_ACTIVITY_REFRESH_INTERVAL_MS = 5_000;

export function useWorkspaces() {
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);
  const { cloudActive } = useCloudAvailabilityState();
  const canQuery = runtimeUrl.trim().length > 0 || cloudActive;

  return useQuery<WorkspaceCollections>({
    queryKey: workspaceCollectionsKey(runtimeUrl, cloudActive),
    queryFn: async () => {
      const startedAt = startLatencyTimer();
      logLatency("workspace.collections.fetch.start", {
        runtimeUrl,
        cloudActive,
      });
      const client = getAnyHarnessClient({ runtimeUrl });
      const [localWorkspaces, repoRoots, cloudWorkspaces] = await Promise.all([
        client.workspaces.list().catch(() => []),
        client.repoRoots.list().catch(() => []),
        cloudActive
          ? listCloudWorkspaces().catch(() => null)
          : Promise.resolve([]),
      ]);
      const collections = buildWorkspaceCollections(
        localWorkspaces,
        repoRoots,
        cloudWorkspaces ?? [],
      );
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
    enabled: canQuery,
    refetchInterval: (query) =>
      workspaceCollectionsNeedActivityRefresh(query.state.data)
        ? WORKSPACE_ACTIVITY_REFRESH_INTERVAL_MS
        : false,
  });
}
