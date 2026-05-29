import { anyHarnessWorkspaceQueryKeyRoots } from "@anyharness/sdk-react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { clearCachedCloudConnections } from "@/hooks/access/cloud/cloud-connection-cache";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/cache/query-keys";

interface ClearWorkspaceOwnerFlipCacheInput {
  logicalWorkspaceId: string;
  previousWorkspaceId: string | null;
  previousCloudWorkspaceId?: string | null;
  nextCloudWorkspaceId?: string | null;
}

async function clearWorkspaceOwnerFlipCacheForRuntime(
  queryClient: QueryClient,
  runtimeUrl: string,
  input: ClearWorkspaceOwnerFlipCacheInput,
): Promise<void> {
  if (input.previousCloudWorkspaceId) {
    await clearCachedCloudConnections(queryClient, input.previousCloudWorkspaceId);
  }
  if (input.nextCloudWorkspaceId) {
    await clearCachedCloudConnections(queryClient, input.nextCloudWorkspaceId);
  }

  const queryRoots = new Set<string>();
  for (const key of [
    input.logicalWorkspaceId,
    input.previousWorkspaceId,
  ]) {
    if (!key) {
      continue;
    }
    for (const root of anyHarnessWorkspaceQueryKeyRoots(runtimeUrl, key)) {
      queryRoots.add(JSON.stringify(root));
    }
  }

  await Promise.all(Array.from(queryRoots, (serializedRoot) => {
    const queryKey = JSON.parse(serializedRoot) as readonly unknown[];
    return queryClient.cancelQueries({ queryKey, exact: false });
  }));

  for (const serializedRoot of queryRoots) {
    const queryKey = JSON.parse(serializedRoot) as readonly unknown[];
    queryClient.removeQueries({ queryKey, exact: false });
  }
}

// Owns cache operations needed while a workspace changes local/cloud ownership.
export function useWorkspaceMobilityCache(runtimeUrl: string) {
  const queryClient = useQueryClient();

  const clearWorkspaceOwnerFlipCache = useCallback((
    input: ClearWorkspaceOwnerFlipCacheInput,
  ) => clearWorkspaceOwnerFlipCacheForRuntime(queryClient, runtimeUrl, input), [
    queryClient,
    runtimeUrl,
  ]);

  const invalidateWorkspaceCollections = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: workspaceCollectionsScopeKey(runtimeUrl),
    });
  }, [queryClient, runtimeUrl]);

  return {
    clearWorkspaceOwnerFlipCache,
    invalidateWorkspaceCollections,
  };
}
