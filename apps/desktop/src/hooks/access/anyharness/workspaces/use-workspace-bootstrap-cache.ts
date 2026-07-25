import type { AnyHarnessRequestOptions } from "@anyharness/sdk";
import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import {
  anyHarnessSessionsKey,
  useAnyHarnessCacheScopeKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  dismissSession,
  listWorkspaceSessions,
} from "@/lib/access/anyharness/sessions";
import type { WorkspaceSession } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import {
  captureReplacedSessionTombstoneGeneration,
  clearReplacedSessionTombstoneFromAuthoritativeList,
  committedReplacedSessionTombstonesForWorkspace,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-durable-operations";
import {
  filterReplacedSessionTombstones,
} from "@/hooks/sessions/workflows/session-replacement-tombstones";
import {
  runTrackedReplacementDismissal,
} from "@/hooks/sessions/workflows/session-replacement-dismissals";
import { useSessionReplacementTombstoneAuthority } from "@/hooks/sessions/derived/use-session-replacement-tombstone-authority";
import {
  waitForSessionReplacementTombstoneHydration,
} from "@/hooks/sessions/workflows/session-replacement-tombstone-authority";
import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";
import type { ProductStorageContext } from "@/lib/infra/persistence/product-storage";

export type CacheDecision = "hit" | "stale" | "miss";

interface LoadWorkspaceSessionsInput {
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

interface FetchWorkspaceSessionsWithPersistenceInput extends FetchWorkspaceSessionsInput {
  persistence: ProductStorageContext;
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
  input: FetchWorkspaceSessionsWithPersistenceInput,
): Promise<WorkspaceSession[]> {
  await waitForSessionReplacementTombstoneHydration();
  const tombstoneGenerationAtRequestStart =
    captureReplacedSessionTombstoneGeneration();
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
  await waitForSessionReplacementTombstoneHydration();
  const visibleSessions = filterReplacedSessionTombstones(input.workspaceId, sessions) ?? [];
  reconcileReplacedSessionTombstones(
    input.persistence,
    input,
    sessions,
    tombstoneGenerationAtRequestStart,
  );
  return visibleSessions.map((session) => ({
    ...session,
    workspaceId: input.workspaceId,
  }));
}

export function reconcileReplacedSessionTombstones(
  persistence: ProductStorageContext,
  input: FetchWorkspaceSessionsInput,
  sessions: readonly { id: string }[],
  requestStartGeneration = captureReplacedSessionTombstoneGeneration(),
): void {
  const listedSessionIds = new Set(sessions.map((session) => session.id));
  for (const sessionId of committedReplacedSessionTombstonesForWorkspace(
    input.workspaceId,
  )) {
    if (!listedSessionIds.has(sessionId)) {
      void clearReplacedSessionTombstoneFromAuthoritativeList(
        persistence,
        input.workspaceId,
        sessionId,
        requestStartGeneration,
      );
      continue;
    }
    // Dismiss best-effort, but retain the tombstone until a later authoritative
    // list omits the id. Clearing on mutation success can expose a stale list
    // response that began before dismissal and resurrect the retired session.
    void runTrackedReplacementDismissal({
      workspaceId: input.workspaceId,
      runtimeSessionId: sessionId,
      run: () => dismissSession(input.workspaceConnection, sessionId)
        .then(() => undefined)
        .catch(() => undefined),
    });
  }
}

// Owns AnyHarness React Query cache shape needed during workspace activation.
export function useWorkspaceBootstrapCache() {
  const persistence = useProductStorageContext();
  const tombstoneAuthority = useSessionReplacementTombstoneAuthority();
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();

  const getWorkspaceSessionsCacheDecision = useCallback((
    workspaceId: string,
  ): CacheDecision => {
    if (!tombstoneAuthority.hydrated) return "miss";
    const queryKey = anyHarnessSessionsKey(cacheScopeKey, workspaceId);
    const cacheState = queryClient.getQueryState(queryKey);
    return cacheState?.dataUpdatedAt
      ? cacheState.isInvalidated ? "stale" : "hit"
      : "miss";
  }, [cacheScopeKey, queryClient, tombstoneAuthority.hydrated]);

  const fetchWorkspaceSessions = useCallback((
    input: FetchWorkspaceSessionsInput,
  ): Promise<WorkspaceSession[]> => fetchWorkspaceSessionsWithConnection({
    ...input,
    persistence,
  }), [persistence]);

  const loadWorkspaceSessions = useCallback(async (
    input: LoadWorkspaceSessionsInput,
  ): Promise<WorkspaceSession[]> => {
    await waitForSessionReplacementTombstoneHydration();
    const queryKey = anyHarnessSessionsKey(cacheScopeKey, input.workspaceId);
    const cacheState = queryClient.getQueryState(queryKey);
    const cachedSessions = queryClient.getQueryData<WorkspaceSession[]>(queryKey);
    if (
      !input.forceRefresh
      && cachedSessions
      && cacheState?.dataUpdatedAt
      && !cacheState.isInvalidated
    ) {
      // Cache hits are not authoritative and must never reconcile staged
      // suppression into destructive cleanup. They still need filtering so an
      // intentionally retained rollback record cannot be reselected/reingested.
      return filterReplacedSessionTombstones(input.workspaceId, cachedSessions) ?? [];
    }

    // Bootstrap/reconcile own workspace activation. Fetch directly instead of
    // joining a possibly hung automatic session-list query triggered by
    // selectedWorkspaceId subscribers, then seed React Query for those surfaces.
    const sessions = await fetchWorkspaceSessionsWithConnection({
      persistence,
      workspaceConnection: input.workspaceConnection,
      workspaceId: input.workspaceId,
      requestOptions: input.requestOptions,
      timeoutMs: input.timeoutMs,
    });
    queryClient.setQueryData(queryKey, sessions);
    return sessions;
  }, [cacheScopeKey, persistence, queryClient, tombstoneAuthority.revision]);

  return {
    fetchWorkspaceSessions,
    getWorkspaceSessionsCacheDecision,
    loadWorkspaceSessions,
  };
}
