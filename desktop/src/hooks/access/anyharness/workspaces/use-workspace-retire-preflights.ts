import type { WorkspaceRetirePreflightResponse } from "@anyharness/sdk";
import {
  anyHarnessWorkspaceRetirePreflightKey,
} from "@anyharness/sdk-react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { getWorkspaceRetirePreflight } from "@/lib/access/anyharness/workspaces";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export type WorkspaceRetirePreflightQuery =
  UseQueryResult<WorkspaceRetirePreflightResponse, Error>;

// Owns AnyHarness retire-preflight query keys and cache shape for workspace lists.
export function useWorkspaceRetirePreflightQueries(
  workspaceIds: string[],
): WorkspaceRetirePreflightQuery[] {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);

  return useQueries({
    queries: workspaceIds.map((workspaceId) => ({
      queryKey: anyHarnessWorkspaceRetirePreflightKey(runtimeUrl, workspaceId),
      enabled: runtimeUrl.trim().length > 0,
      staleTime: 60_000,
      queryFn: async ({ signal }) => {
        return getWorkspaceRetirePreflight({ runtimeUrl }, workspaceId, { signal });
      },
    })),
  });
}
