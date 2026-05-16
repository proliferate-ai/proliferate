import type { WorkspaceRetirePreflightResponse } from "@anyharness/sdk";
import {
  anyHarnessWorkspaceRetirePreflightKey,
} from "@anyharness/sdk-react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { getWorkspaceRetirePreflight } from "@/lib/access/anyharness/workspaces";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export type WorkspaceRetirePreflightQuery =
  UseQueryResult<WorkspaceRetirePreflightResponse, Error>;

const RETIRE_PREFLIGHT_INITIAL_BATCH_SIZE = 4;
const RETIRE_PREFLIGHT_BATCH_SIZE = 4;
const RETIRE_PREFLIGHT_BATCH_DELAY_MS = 1_200;

// Owns AnyHarness retire-preflight query keys and cache shape for workspace lists.
export function useWorkspaceRetirePreflightQueries(
  workspaceIds: string[],
): WorkspaceRetirePreflightQuery[] {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const enabledWorkspaceIds = useBatchedRetirePreflightWorkspaceIds(workspaceIds);

  return useQueries({
    queries: workspaceIds.map((workspaceId) => ({
      queryKey: anyHarnessWorkspaceRetirePreflightKey(runtimeUrl, workspaceId),
      enabled: runtimeUrl.trim().length > 0 && enabledWorkspaceIds.has(workspaceId),
      staleTime: 60_000,
      retry: false,
      queryFn: async ({ signal }) => {
        return getWorkspaceRetirePreflight({ runtimeUrl }, workspaceId, { signal });
      },
    })),
  });
}

function useBatchedRetirePreflightWorkspaceIds(workspaceIds: string[]): Set<string> {
  const workspaceSignature = useMemo(() => workspaceIds.join("\u001f"), [workspaceIds]);
  const [enabledCount, setEnabledCount] = useState(() =>
    Math.min(RETIRE_PREFLIGHT_INITIAL_BATCH_SIZE, workspaceIds.length)
  );

  useEffect(() => {
    setEnabledCount(Math.min(RETIRE_PREFLIGHT_INITIAL_BATCH_SIZE, workspaceIds.length));
  }, [workspaceIds.length, workspaceSignature]);

  useEffect(() => {
    if (enabledCount >= workspaceIds.length) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setEnabledCount((current) =>
        Math.min(current + RETIRE_PREFLIGHT_BATCH_SIZE, workspaceIds.length)
      );
    }, RETIRE_PREFLIGHT_BATCH_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [enabledCount, workspaceIds.length, workspaceSignature]);

  return useMemo(
    () => new Set(workspaceIds.slice(0, enabledCount)),
    [enabledCount, workspaceIds],
  );
}
