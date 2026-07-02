import {
  anyHarnessRepoRootPullRequestsKey,
  anyHarnessWorktreesInventoryKey,
} from "@anyharness/sdk-react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  listRepoRootPullRequestStatuses,
  type RepoPullRequestStatusesResult,
} from "@/lib/access/anyharness/pull-requests";
import { isTimestampNewer } from "@/lib/domain/workspaces/git-status/workspace-git-status-model";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

// Trailing debounce so bursts (several turns ending at once) coalesce into a
// single refresh=1 request per repo root.
const PR_STATUS_REFRESH_DEBOUNCE_MS = 250;

const pendingRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

function refreshTimerKey(runtimeUrl: string, repoRootId: string): string {
  return `${runtimeUrl}::${repoRootId}`;
}

// Monotonic guard: never replace cached data whose fetchedAt is newer, and
// never destroy good entries with an outage result.
function mergeRefreshedPrStatuses(
  previous: RepoPullRequestStatusesResult | undefined,
  next: RepoPullRequestStatusesResult,
): RepoPullRequestStatusesResult {
  if (!previous) {
    return next;
  }
  if (next.availability !== "ok") {
    return previous.availability === "ok" ? previous : next;
  }
  if (previous.fetchedAt && isTimestampNewer(previous.fetchedAt, next.fetchedAt)) {
    return previous;
  }
  return next;
}

async function runRepoPrStatusRefresh(input: {
  queryClient: QueryClient;
  runtimeUrl: string;
  repoRootId: string;
}): Promise<void> {
  const { queryClient, runtimeUrl, repoRootId } = input;
  const result = await listRepoRootPullRequestStatuses(
    { runtimeUrl },
    repoRootId,
    { refresh: true },
  );
  queryClient.setQueryData<RepoPullRequestStatusesResult>(
    anyHarnessRepoRootPullRequestsKey(runtimeUrl, repoRootId),
    (previous) => mergeRefreshedPrStatuses(previous, result),
  );
  // Layer 0 (ahead/behind/dirty) refreshes on the same triggers: the worktree
  // inventory query has no other desktop refetch trigger.
  await queryClient.invalidateQueries({
    queryKey: anyHarnessWorktreesInventoryKey(runtimeUrl),
  });
}

export function scheduleRepoPrStatusRefresh(input: {
  queryClient: QueryClient;
  runtimeUrl: string;
  repoRootId: string;
}): void {
  const runtimeUrl = input.runtimeUrl.trim();
  const repoRootId = input.repoRootId.trim();
  if (!runtimeUrl || !repoRootId) {
    return;
  }
  const key = refreshTimerKey(runtimeUrl, repoRootId);
  const existing = pendingRefreshTimers.get(key);
  if (existing !== undefined) {
    clearTimeout(existing);
  }
  pendingRefreshTimers.set(key, setTimeout(() => {
    pendingRefreshTimers.delete(key);
    void runRepoPrStatusRefresh({
      queryClient: input.queryClient,
      runtimeUrl,
      repoRootId,
    });
  }, PR_STATUS_REFRESH_DEBOUNCE_MS));
}

export function resetPrStatusRefreshForTests(): void {
  for (const timer of pendingRefreshTimers.values()) {
    clearTimeout(timer);
  }
  pendingRefreshTimers.clear();
}

// The only writer of the repo-root PR status keys.
export function useRefreshPrStatuses() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);

  return useCallback((repoRootId: string) => {
    scheduleRepoPrStatusRefresh({ queryClient, runtimeUrl, repoRootId });
  }, [queryClient, runtimeUrl]);
}
