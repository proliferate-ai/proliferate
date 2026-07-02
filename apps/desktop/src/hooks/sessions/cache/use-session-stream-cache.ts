import {
  anyHarnessCoworkManagedWorkspacesKey,
  anyHarnessRuntimeKey,
  anyHarnessGitStatusKey,
  anyHarnessSessionReviewsKey,
  anyHarnessSessionSubagentsKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  getWorkspaceCollectionsFromCache,
  workspaceCollectionsScopeKey,
} from "@/hooks/workspaces/cache/query-keys";
import { scheduleRepoPrStatusRefresh } from "@/hooks/workspaces/cache/use-pr-status-refresh";
import { useAuthStore } from "@/stores/auth/auth-store";

export interface SessionStreamCache {
  invalidateWorkspaceCollections(runtimeUrl: string): void;
  invalidateSessionSubagents(input: {
    runtimeUrl: string;
    workspaceId: string | null;
    sessionId: string;
  }): void;
  invalidateCoworkManagedWorkspaces(input: {
    runtimeUrl: string;
    sessionId: string;
  }): void;
  invalidateSessionReviews(input: {
    runtimeUrl: string;
    workspaceId: string | null;
    parentSessionId: string;
  }): void;
  invalidateGitStatus(input: {
    runtimeUrl: string;
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

  return useMemo<SessionStreamCache>(() => ({
    invalidateWorkspaceCollections(runtimeUrl) {
      void queryClient.invalidateQueries({
        queryKey: workspaceCollectionsScopeKey(runtimeUrl),
      });
    },
    invalidateSessionSubagents({ runtimeUrl, workspaceId, sessionId }) {
      void queryClient.invalidateQueries({
        queryKey: anyHarnessSessionSubagentsKey(runtimeUrl, workspaceId, sessionId),
      });
    },
    invalidateCoworkManagedWorkspaces({ runtimeUrl, sessionId }) {
      void queryClient.invalidateQueries({
        queryKey: anyHarnessCoworkManagedWorkspacesKey(runtimeUrl, sessionId),
      });
      void queryClient.invalidateQueries({
        queryKey: [...anyHarnessRuntimeKey(runtimeUrl), "cowork", "sessions"],
      });
    },
    invalidateSessionReviews({ runtimeUrl, workspaceId, parentSessionId }) {
      void queryClient.invalidateQueries({
        queryKey: anyHarnessSessionReviewsKey(runtimeUrl, workspaceId, parentSessionId),
      });
    },
    invalidateGitStatus({ runtimeUrl, workspaceId }) {
      void queryClient.invalidateQueries({
        queryKey: anyHarnessGitStatusKey(runtimeUrl, workspaceId),
      });
    },
    refreshPrStatuses({ runtimeUrl, workspaceId }) {
      // Resolve the workspace's repo root from the cached collections; a
      // miss (e.g. cloud runtime, collections not loaded) degrades to a
      // no-op — the next turn end or message send retries.
      const collections = getWorkspaceCollectionsFromCache(
        queryClient,
        runtimeUrl,
        useAuthStore.getState().user?.id ?? null,
      );
      const repoRootId = collections?.allWorkspaces
        .find((workspace) => workspace.id === workspaceId)
        ?.repoRootId?.trim();
      if (!repoRootId) {
        return;
      }
      scheduleRepoPrStatusRefresh({ queryClient, runtimeUrl, repoRootId });
    },
  }), [queryClient]);
}
