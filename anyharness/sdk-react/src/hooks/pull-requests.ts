import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreatePullRequestRequest, MergePullRequestRequest } from "@anyharness/sdk";
import {
  useAnyHarnessWorkspaceContext,
  resolveWorkspaceConnectionFromContext,
} from "../context/AnyHarnessWorkspace.js";
import {
  useAnyHarnessRuntimeContext,
  resolveRuntimeConnection,
} from "../context/AnyHarnessRuntime.js";
import { getAnyHarnessClient } from "../lib/client-cache.js";
import {
  anyHarnessPullRequestKey,
  anyHarnessRepoRootPullRequestsKey,
  anyHarnessRepoRootsKey,
} from "../lib/query-keys.js";
import { requestOptionsWithSignal } from "../lib/request-options.js";

interface WorkspaceQueryOptions {
  workspaceId?: string | null;
  enabled?: boolean;
}

function useWorkspaceRuntimeUrl() {
  const runtime = useAnyHarnessRuntimeContext();
  return runtime.runtimeUrl?.trim() ?? "";
}

export function useCurrentPullRequestQuery(options?: WorkspaceQueryOptions) {
  const workspace = useAnyHarnessWorkspaceContext();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useQuery({
    queryKey: anyHarnessPullRequestKey(runtimeUrl, workspaceId),
    enabled: (options?.enabled ?? true) && !!workspaceId,
    retry: false,
    queryFn: async ({ signal }) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.pullRequests.getCurrent(
        resolved.connection.anyharnessWorkspaceId,
        requestOptionsWithSignal(undefined, signal),
      );
    },
  });
}

export function useRepoPullRequestStatusesQuery(options: {
  repoRootId?: string | null;
  enabled?: boolean;
  staleTime?: number;
  refetchInterval?: number | false;
  refetchOnWindowFocus?: boolean;
}) {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const repoRootId = options.repoRootId ?? null;

  return useQuery({
    queryKey: anyHarnessRepoRootPullRequestsKey(runtimeUrl, repoRootId),
    enabled: (options.enabled ?? true) && runtimeUrl.length > 0 && !!repoRootId,
    retry: false,
    staleTime: options.staleTime,
    refetchInterval: options.refetchInterval,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    queryFn: async ({ signal }) => {
      const client = getAnyHarnessClient(resolveRuntimeConnection(runtime));
      return client.pullRequests.listForRepoRoot(
        repoRootId!,
        undefined,
        requestOptionsWithSignal(undefined, signal),
      );
    },
  });
}

export function useCreatePullRequestMutation(options?: { workspaceId?: string | null }) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;

  return useMutation({
    mutationFn: async (input: CreatePullRequestRequest) => {
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.pullRequests.create(resolved.connection.anyharnessWorkspaceId, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: anyHarnessPullRequestKey(runtimeUrl, workspaceId),
      });
    },
  });
}

export function useMergePullRequestMutation(options?: {
  workspaceId?: string | null;
  repoRootId?: string | null;
}) {
  const workspace = useAnyHarnessWorkspaceContext();
  const queryClient = useQueryClient();
  const runtimeUrl = useWorkspaceRuntimeUrl();
  const workspaceId = options?.workspaceId ?? workspace.workspaceId;
  const repoRootId = options?.repoRootId ?? null;

  return useMutation({
    mutationFn: async (input: MergePullRequestRequest & { prNumber: number }) => {
      const { prNumber, ...body } = input;
      const resolved = await resolveWorkspaceConnectionFromContext(workspace, workspaceId);
      const client = getAnyHarnessClient(resolved.connection);
      return client.pullRequests.merge(resolved.connection.anyharnessWorkspaceId, prNumber, body);
    },
    onSuccess: async () => {
      const invalidations = [
        queryClient.invalidateQueries({
          queryKey: anyHarnessPullRequestKey(runtimeUrl, workspaceId),
        }),
      ];
      if (repoRootId) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: anyHarnessRepoRootPullRequestsKey(runtimeUrl, repoRootId),
          }),
        );
      } else {
        // Fallback: invalidate all repo-root PR-status queries for this runtime.
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: anyHarnessRepoRootsKey(runtimeUrl),
            predicate: (query) =>
              query.queryKey[query.queryKey.length - 1] === "pull-requests",
          }),
        );
      }
      await Promise.all(invalidations);
    },
  });
}
