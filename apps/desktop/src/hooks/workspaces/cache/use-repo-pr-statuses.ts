import type { BranchPullRequestStatus } from "@anyharness/sdk";
import { anyHarnessRepoRootPullRequestsKey } from "@anyharness/sdk-react";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  listRepoRootPullRequestStatuses,
  type RepoPullRequestStatusesResult,
} from "@/lib/access/anyharness/pull-requests";
import type { WorkspacePrStatusAvailability } from "@/lib/domain/workspaces/git-status/workspace-git-status-model";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

const PR_STATUS_STALE_MS = 60_000;
const PR_STATUS_REFETCH_INTERVAL_MS = 120_000;

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
  const trimmedRuntimeUrl = runtimeUrl.trim();

  const ids = useMemo(
    () => [...new Set(repoRootIds.filter((id) => id.trim().length > 0))].sort(),
    [repoRootIds],
  );

  return useQueries({
    queries: ids.map((repoRootId) => ({
      queryKey: anyHarnessRepoRootPullRequestsKey(trimmedRuntimeUrl, repoRootId),
      enabled: trimmedRuntimeUrl.length > 0,
      staleTime: PR_STATUS_STALE_MS,
      refetchInterval: PR_STATUS_REFETCH_INTERVAL_MS,
      // Per-key opt-in: the desktop QueryClient default is false.
      refetchOnWindowFocus: true,
      retry: false as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        listRepoRootPullRequestStatuses(
          { runtimeUrl: trimmedRuntimeUrl },
          repoRootId,
          { refresh: false },
          { signal },
        ),
    })),
    combine: (results) => {
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
  });
}
