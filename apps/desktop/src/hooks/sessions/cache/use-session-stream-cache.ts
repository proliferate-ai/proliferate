import {
  anyHarnessCoworkManagedWorkspacesKey,
  anyHarnessRuntimeKey,
  anyHarnessGitStatusKey,
  anyHarnessSessionReviewsKey,
  anyHarnessSessionSubagentsKey,
  useAnyHarnessCacheScopeKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  getWorkspaceCollectionsFromCache,
  workspaceCollectionsScopeKey,
} from "@/hooks/workspaces/cache/query-keys";
import { scheduleRepoPrStatusRefresh } from "@/hooks/workspaces/cache/use-pr-status-refresh";

export interface SessionStreamCache {
  invalidateWorkspaceCollections(runtimeUrl: string): void;
  invalidateSessionSubagents(input: {
    workspaceId: string | null;
    sessionId: string;
  }): void;
  invalidateCoworkManagedWorkspaces(input: {
    runtimeUrl: string;
    sessionId: string;
  }): void;
  invalidateSessionReviews(input: {
    workspaceId: string | null;
    parentSessionId: string;
  }): void;
  invalidateGitStatus(input: {
    workspaceId: string;
  }): void;
  refreshPrStatuses(input: {
    runtimeUrl: string;
    workspaceId: string;
  }): void;
}

// Owns React Query invalidation triggered by session stream events.
// Does not interpret stream envelopes or mutate session stores.
export function useSessionStreamCache(): SessionStreamCache {
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const authState = useProductHost().auth.state;
  const authUserId = authState.status === "authenticated"
    ? authState.user?.id ?? null
    : null;

  return useMemo<SessionStreamCache>(() => ({
    invalidateWorkspaceCollections(runtimeUrl) {
      void queryClient.invalidateQueries({
        queryKey: workspaceCollectionsScopeKey(runtimeUrl),
      });
    },
    invalidateSessionSubagents({ workspaceId, sessionId }) {
      void queryClient.invalidateQueries({
        queryKey: anyHarnessSessionSubagentsKey(cacheScopeKey, workspaceId, sessionId),
      });
    },
    invalidateCoworkManagedWorkspaces({ runtimeUrl, sessionId }) {
      void queryClient.invalidateQueries({
        queryKey: anyHarnessCoworkManagedWorkspacesKey(
          runtimeUrl,
          sessionId,
          cacheScopeKey,
        ),
      });
      void queryClient.invalidateQueries({
        queryKey: [
          ...anyHarnessRuntimeKey(runtimeUrl, cacheScopeKey),
          "cowork",
          "sessions",
        ],
      });
    },
    invalidateSessionReviews({ workspaceId, parentSessionId }) {
      void queryClient.invalidateQueries({
        queryKey: anyHarnessSessionReviewsKey(
          cacheScopeKey,
          workspaceId,
          parentSessionId,
        ),
      });
    },
    invalidateGitStatus({ workspaceId }) {
      void queryClient.invalidateQueries({
        queryKey: anyHarnessGitStatusKey(cacheScopeKey, workspaceId),
      });
    },
    refreshPrStatuses({ runtimeUrl, workspaceId }) {
      // Resolve the workspace's repo root from the cached collections; a
      // miss (e.g. cloud runtime, collections not loaded) degrades to a
      // no-op — the next turn end or message send retries.
      const collections = getWorkspaceCollectionsFromCache(
        queryClient,
        runtimeUrl,
        authUserId,
      );
      const repoRootId = collections?.allWorkspaces
        .find((workspace) => workspace.id === workspaceId)
        ?.repoRootId?.trim();
      if (!repoRootId) {
        return;
      }
      scheduleRepoPrStatusRefresh({
        queryClient,
        runtimeUrl,
        repoRootId,
        cacheScopeKey,
      });
    },
  }), [authUserId, cacheScopeKey, queryClient]);
}
