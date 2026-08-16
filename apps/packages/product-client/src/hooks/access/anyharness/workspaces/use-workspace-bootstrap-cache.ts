import type { AnyHarnessRequestOptions } from "@anyharness/sdk";
import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import {
  anyHarnessSessionsKey,
  useAnyHarnessCacheScopeKey,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import {
  dismissSession,
  listWorkspaceSessions,
} from "#product/lib/access/anyharness/sessions";
import type { WorkspaceSession } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import {
  captureReplacedSessionTombstoneGeneration,
  clearReplacedSessionTombstoneFromAuthoritativeList,
  committedReplacedSessionTombstonesForWorkspace,
  filterReplacedSessionTombstones,
} from "#product/hooks/sessions/workflows/session-replacement-tombstones";
import {
  runTrackedReplacementDismissal,
} from "#product/hooks/sessions/workflows/session-replacement-dismissals";
import {
  addReplacedSessionTombstoneCommitListener,
} from "#product/hooks/sessions/workflows/session-replacement-tombstone-listeners";
import {
  pinWorkspaceSessionsQueryWarm,
} from "#product/hooks/access/anyharness/workspaces/workspace-session-directory-keepalive";

export type CacheDecision = "hit" | "stale" | "miss";

interface LoadWorkspaceSessionsInput {
  workspaceConnection: AnyHarnessResolvedConnection;
  workspaceId: string;
  isCurrent?: () => boolean;
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
  isResultOwned?: () => boolean;
}

function requestOptionsWithSignal(
  requestOptions: AnyHarnessRequestOptions | undefined,
  timeoutSignal: AbortSignal,
): AnyHarnessRequestOptions {
  const callerSignal = requestOptions?.signal;
  // Compose the caller's abort (e.g. a superseded workspace selection, UX
  // Latency ADR §4.6 Rung 9) with the bootstrap timeout so either can cancel
  // the request on the wire. Aborting on caller supersession must not disarm the
  // 8s ceiling, and the timeout must not mask an intentional supersession.
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;
  return {
    ...requestOptions,
    signal,
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
  const visibleSessions = filterReplacedSessionTombstones(input.workspaceId, sessions) ?? [];
  if (input.isResultOwned?.() !== false) {
    reconcileReplacedSessionTombstones(
      input,
      sessions,
      tombstoneGenerationAtRequestStart,
    );
  }
  return visibleSessions.map((session) => ({
    ...session,
    workspaceId: input.workspaceId,
  }));
}

export function reconcileReplacedSessionTombstones(
  input: FetchWorkspaceSessionsInput,
  sessions: readonly { id: string }[],
  requestStartGeneration = captureReplacedSessionTombstoneGeneration(),
): void {
  const listedSessionIds = new Set(sessions.map((session) => session.id));
  for (const sessionId of committedReplacedSessionTombstonesForWorkspace(
    input.workspaceId,
  )) {
    if (!listedSessionIds.has(sessionId)) {
      clearReplacedSessionTombstoneFromAuthoritativeList(
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
  const queryClient = useQueryClient();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();

  // UX-latency R14: keep warm-pinned session-directory entries truthful. When a
  // replaced session's tombstone durably commits, invalidate the affected
  // workspace's sessions query so a warm entry cannot keep showing a retired
  // session; default refetchType lets any live list observer revalidate
  // immediately (founder ruling: not stale-tolerant, fetch immediately).
  useEffect(() => {
    return addReplacedSessionTombstoneCommitListener((workspaceId) => {
      void queryClient.invalidateQueries({
        queryKey: anyHarnessSessionsKey(cacheScopeKey, workspaceId),
      });
    });
  }, [cacheScopeKey, queryClient]);

  const getWorkspaceSessionsCacheDecision = useCallback((
    workspaceId: string,
  ): CacheDecision => {
    const queryKey = anyHarnessSessionsKey(cacheScopeKey, workspaceId);
    const cacheState = queryClient.getQueryState(queryKey);
    return cacheState?.dataUpdatedAt
      ? cacheState.isInvalidated ? "stale" : "hit"
      : "miss";
  }, [cacheScopeKey, queryClient]);

  const fetchWorkspaceSessions = useCallback((
    input: FetchWorkspaceSessionsInput,
  ): Promise<WorkspaceSession[]> => fetchWorkspaceSessionsWithConnection(input), []);

  const loadWorkspaceSessions = useCallback(async (
    input: LoadWorkspaceSessionsInput,
  ): Promise<WorkspaceSession[]> => {
    const queryKey = anyHarnessSessionsKey(cacheScopeKey, input.workspaceId);
    // UX-latency R14: pin this workspace's session query warm (bounded LRU) so
    // an intra-run revisit finds it in cache instead of a cold miss.
    pinWorkspaceSessionsQueryWarm(queryClient, queryKey);
    const fetchAndSeed = async (): Promise<WorkspaceSession[]> => {
      // Bootstrap/reconcile own workspace activation. Fetch directly instead of
      // joining a possibly hung automatic session-list query triggered by
      // selectedWorkspaceId subscribers, then seed React Query for those
      // surfaces.
      const sessions = await fetchWorkspaceSessionsWithConnection({
        workspaceConnection: input.workspaceConnection,
        workspaceId: input.workspaceId,
        requestOptions: input.requestOptions,
        timeoutMs: input.timeoutMs,
        isResultOwned: input.isCurrent,
      });
      if (input.isCurrent?.() === false) {
        return sessions;
      }
      queryClient.setQueryData(queryKey, sessions);
      return sessions;
    };

    const cacheState = queryClient.getQueryState(queryKey);
    const cachedSessions = queryClient.getQueryData<WorkspaceSession[]>(queryKey);
    if (
      !input.forceRefresh
      && cachedSessions
      && cacheState?.dataUpdatedAt
      && !cacheState.isInvalidated
    ) {
      // Warm serve for first paint. Founder ruling: NOT stale-tolerant SWR —
      // kick an immediate background revalidation so the list stays genuinely
      // up to date, but return the warm list without blocking first paint on
      // the network. Cache hits are not authoritative and must never reconcile
      // staged suppression into destructive cleanup, so the synchronous serve
      // only filters (an intentionally retained rollback record must not be
      // reselected/reingested); the background fetch does the authoritative
      // reconcile.
      void fetchAndSeed().catch(() => undefined);
      return filterReplacedSessionTombstones(input.workspaceId, cachedSessions) ?? [];
    }

    return fetchAndSeed();
  }, [cacheScopeKey, queryClient]);

  return {
    fetchWorkspaceSessions,
    getWorkspaceSessionsCacheDecision,
    loadWorkspaceSessions,
  };
}
