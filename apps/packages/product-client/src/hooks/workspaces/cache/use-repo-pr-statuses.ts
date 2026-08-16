import type { BranchPullRequestStatus } from "@anyharness/sdk";
import {
  anyHarnessRepoRootPullRequestsKey,
  useAnyHarnessCacheScopeKey,
} from "@anyharness/sdk-react";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  listRepoRootPullRequestStatuses,
  type RepoPullRequestStatusesResult,
} from "#product/lib/access/anyharness/pull-requests";
import type { WorkspacePrStatusAvailability } from "#product/lib/domain/workspaces/git-status/workspace-git-status-model";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

const PR_STATUS_STALE_MS = 60_000;

export interface RepoPrStatusesState {
  entriesByRepoRootId: Record<string, BranchPullRequestStatus[]>;
  availabilityByRepoRootId: Record<string, WorkspacePrStatusAvailability>;
  fetchedAtByRepoRootId: Record<string, string | null>;
}

// Cache owner for the per-repo-root PR status queries. Repo-root ids are a
// parameter supplied by the derived composer; this hook imports no derived
// hooks. Reads only — the sole writer of these keys is use-pr-status-refresh.
export function useRepoPrStatuses(repoRootIds: string[]): RepoPrStatusesState {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const trimmedRuntimeUrl = runtimeUrl.trim();

  const ids = useMemo(
    () => [...new Set(repoRootIds.filter((id) => id.trim().length > 0))].sort(),
    [repoRootIds],
  );

  // Memoize the query descriptors so a shell re-render (e.g. a workspace
  // switch) does not rebuild every per-repo option object and force
  // observer.setOptions churn when the inputs are unchanged.
  const queries = useMemo(
    () =>
      ids.map((repoRootId) => ({
        queryKey: anyHarnessRepoRootPullRequestsKey(
          trimmedRuntimeUrl,
          repoRootId,
          cacheScopeKey,
        ),
        enabled: trimmedRuntimeUrl.length > 0,
        staleTime: PR_STATUS_STALE_MS,
        // No interval/focus polling (owner decision 2026-07-02): PR status
        // updates on session turn end (stream side effects), message send, and
        // publish, plus this initial mount fetch. The daemon throttle makes
        // extra polling pointless anyway.
        refetchOnWindowFocus: false,
        retry: false as const,
        queryFn: async ({ signal }: { signal: AbortSignal }) =>
          listRepoRootPullRequestStatuses(
            { runtimeUrl: trimmedRuntimeUrl },
            repoRootId,
            { refresh: false },
            { signal },
          ),
      })),
    [ids, trimmedRuntimeUrl, cacheScopeKey],
  );

  // Stable combine reference so react-query only recomputes the merged view
  // when the results or the id ordering actually change, not on every render.
  const combine = useCallback(
    (results: { data: unknown }[]): RepoPrStatusesState => {
      const entriesByRepoRootId: Record<string, BranchPullRequestStatus[]> = {};
      const availabilityByRepoRootId: Record<string, WorkspacePrStatusAvailability> = {};
      const fetchedAtByRepoRootId: Record<string, string | null> = {};
      results.forEach((result, index) => {
        const repoRootId = ids[index];
        const data = result.data as RepoPullRequestStatusesResult | undefined;
        if (!repoRootId || !data) {
          return;
        }
        entriesByRepoRootId[repoRootId] = data.entries;
        availabilityByRepoRootId[repoRootId] = data.availability;
        fetchedAtByRepoRootId[repoRootId] = data.fetchedAt;
      });
      return { entriesByRepoRootId, availabilityByRepoRootId, fetchedAtByRepoRootId };
    },
    [ids],
  );

  return useQueries({ queries, combine });
}
