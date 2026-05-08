import {
  anyHarnessCoworkManagedWorkspacesKey,
  anyHarnessGitStatusKey,
  anyHarnessSessionReviewsKey,
  anyHarnessSessionSubagentsKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";

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
  }), [queryClient]);
}
