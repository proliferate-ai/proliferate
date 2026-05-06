import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PrepareRepoRootMobilityDestinationRequest } from "@anyharness/sdk";
import { useAnyHarnessRuntimeContext, resolveRuntimeConnection } from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";
import {
  anyHarnessRepoRootDetectSetupKey,
  anyHarnessRepoRootGitBranchesKey,
  anyHarnessRepoRootsKey,
  anyHarnessRuntimeWorkspacesKey,
} from "../lib/query-keys.js";

interface RuntimeQueryOptions {
  enabled?: boolean;
}

export function useRepoRootsQuery(options?: RuntimeQueryOptions) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessRepoRootsKey(runtimeUrl),
    enabled: (options?.enabled ?? true) && runtimeUrl.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.repoRoots.list(requestOptionsWithSignal(undefined, signal));
    },
  });
}

export function useResolveRepoRootFromPathMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationFn: async (path: string) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.repoRoots.resolveFromPath(path);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessRepoRootsKey(runtimeUrl),
      });
    },
  });
}

export function useRepoRootGitBranchesQuery(options: {
  repoRootId?: string | null;
  enabled?: boolean;
}) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const repoRootId = options.repoRootId?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessRepoRootGitBranchesKey(runtimeUrl, repoRootId),
    enabled: (options.enabled ?? true) && repoRootId.length > 0 && runtimeUrl.length > 0,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.repoRoots.listBranches(repoRootId, requestOptionsWithSignal(undefined, signal));
    },
  });
}

export function useDetectRepoRootSetupQuery(options: {
  repoRootId?: string | null;
  enabled?: boolean;
}) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const repoRootId = options.repoRootId?.trim() ?? "";

  return useQuery({
    queryKey: anyHarnessRepoRootDetectSetupKey(runtimeUrl, repoRootId),
    enabled: (options.enabled ?? true) && repoRootId.length > 0 && runtimeUrl.length > 0,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.repoRoots.detectSetup(repoRootId, requestOptionsWithSignal(undefined, signal));
    },
  });
}

export function usePrepareRepoRootMobilityDestinationMutation() {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";

  return useMutation({
    mutationFn: async ({
      repoRootId,
      input,
    }: {
      repoRootId: string;
      input: PrepareRepoRootMobilityDestinationRequest;
    }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.repoRoots.prepareDestination(repoRootId, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessRuntimeWorkspacesKey(runtimeUrl),
      });
    },
  });
}
