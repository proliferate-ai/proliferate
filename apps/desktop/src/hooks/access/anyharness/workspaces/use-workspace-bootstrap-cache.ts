import type {
  AnyHarnessRequestOptions,
} from "@anyharness/sdk";
import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import {
  anyHarnessSessionsKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { listWorkspaceSessions } from "@/lib/access/anyharness/sessions";
import type { WorkspaceSession } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";

export type CacheDecision = "hit" | "stale" | "miss";

interface LoadWorkspaceSessionsInput {
  runtimeUrl: string;
  workspaceConnection: AnyHarnessResolvedConnection;
  workspaceId: string;
  requestOptions?: AnyHarnessRequestOptions;
  forceRefresh?: boolean;
  timeoutMs?: number;
}

interface FetchWorkspaceSessionsInput {
  workspaceConnection: AnyHarnessResolvedConnection;
  workspaceId: string;
  includeDismissed?: boolean;
  requestOptions?: AnyHarnessRequestOptions;
  timeoutMs?: number;
}

function requestOptionsWithSignal(
  requestOptions: AnyHarnessRequestOptions | undefined,
  signal: AbortSignal,
): AnyHarnessRequestOptions {
  return {
    ...requestOptions,
    signal: requestOptions?.signal ?? signal,
  };
}

async function withAbortTimeout<T>(
  timeoutMs: number | undefined,
  run: (signal: AbortSignal | null) => Promise<T>,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return await run(null);
  }

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
      controller.abort();
    }, timeoutMs);
  });
  const runPromise = run(controller.signal);
  runPromise.catch(() => undefined);
  try {
    return await Promise.race([runPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

async function fetchWorkspaceSessionsWithConnection(
  input: FetchWorkspaceSessionsInput,
): Promise<WorkspaceSession[]> {
  const sessions = await withAbortTimeout(
    input.timeoutMs,
    async (signal) => {
      const timedRequestOptions = signal
        ? requestOptionsWithSignal(input.requestOptions, signal)
        : input.requestOptions;
      const requestOptions = input.includeDismissed
        ? { ...timedRequestOptions, includeDismissed: true }
        : timedRequestOptions;
      return await listWorkspaceSessions(input.workspaceConnection, requestOptions);
    },
  );
  return sessions.map((session) => ({
    ...session,
    workspaceId: input.workspaceId,
  }));
}

// Owns AnyHarness React Query cache shape needed during workspace activation.
export function useWorkspaceBootstrapCache() {
  const queryClient = useQueryClient();

  const getWorkspaceSessionsCacheDecision = useCallback((
    runtimeUrl: string,
    workspaceId: string,
  ): CacheDecision => {
    const queryKey = anyHarnessSessionsKey(runtimeUrl, workspaceId);
    const cacheState = queryClient.getQueryState(queryKey);
    return cacheState?.dataUpdatedAt
      ? cacheState.isInvalidated ? "stale" : "hit"
      : "miss";
  }, [queryClient]);

  const fetchWorkspaceSessions = useCallback((
    input: FetchWorkspaceSessionsInput,
  ): Promise<WorkspaceSession[]> => fetchWorkspaceSessionsWithConnection(input), []);

  const loadWorkspaceSessions = useCallback(async (
    input: LoadWorkspaceSessionsInput,
  ): Promise<WorkspaceSession[]> => {
    const queryKey = anyHarnessSessionsKey(input.runtimeUrl, input.workspaceId);
    const cacheState = queryClient.getQueryState(queryKey);
    const cachedSessions = queryClient.getQueryData<WorkspaceSession[]>(queryKey);
    if (
      !input.forceRefresh
      && cachedSessions
      && cacheState?.dataUpdatedAt
      && !cacheState.isInvalidated
    ) {
      return cachedSessions;
    }

    // Bootstrap/reconcile own workspace activation. Fetch directly instead of
    // joining a possibly hung automatic session-list query triggered by
    // selectedWorkspaceId subscribers, then seed React Query for those surfaces.
    const sessions = await fetchWorkspaceSessionsWithConnection({
      workspaceConnection: input.workspaceConnection,
      workspaceId: input.workspaceId,
      requestOptions: input.requestOptions,
      timeoutMs: input.timeoutMs,
    });
    queryClient.setQueryData(queryKey, sessions);
    return sessions;
  }, [queryClient]);

  return {
    fetchWorkspaceSessions,
    getWorkspaceSessionsCacheDecision,
    loadWorkspaceSessions,
  };
}
