import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PruneOrphanWorktreeRequest } from "@anyharness/sdk";
import {
  resolveRuntimeCacheScopeKey,
  resolveRuntimeConnection,
  useAnyHarnessRuntimeContext,
} from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";
import {
  anyHarnessRuntimeWorkspacesKey,
  anyHarnessWorktreesInventoryKey,
} from "../lib/query-keys.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
}

export function useWorktreeInventoryQuery(options?: RuntimeQueryOptions) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);

  return useQuery({
    queryKey: anyHarnessWorktreesInventoryKey(runtimeUrl, cacheScopeKey),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.worktrees.inventory(requestOptionsWithSignal(undefined, signal));
    },
  });
}

export function usePruneOrphanWorktreeMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);

  return useMutation({
    mutationFn: async (input: PruneOrphanWorktreeRequest) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.worktrees.pruneOrphan(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessWorktreesInventoryKey(runtimeUrl, cacheScopeKey),
      });
      await queryClient.invalidateQueries({
        queryKey: anyHarnessRuntimeWorkspacesKey(runtimeUrl, cacheScopeKey),
      });
    },
  });
}
