import type { AgentAuthMethodRow, AgentAuthStatusDoc } from "@anyharness/sdk";
import {
  anyHarnessAgentAuthMethodsKey,
  anyHarnessAgentAuthStatusKey,
  resolveRuntimeCacheScopeKey,
  resolveRuntimeConnection,
  useAnyHarnessRuntimeContext,
} from "@anyharness/sdk-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import {
  getHarnessAuthMethods,
  getHarnessAuthStatus,
  openHarnessAuthStatusStream,
} from "#product/lib/access/anyharness/agent-auth";

/** The applied-method tag on a status document. */
export type HarnessAppliedMethod = NonNullable<AgentAuthStatusDoc["applied"]>;
/** The serve-stale probe observation on a status document. */
export type HarnessProbeStatus = AgentAuthStatusDoc["probe"];

/**
 * The ONE access-layer seam for a harness's auth truth (agent_auth spec §4
 * cell 4). The six named fields ARE the status document, camel-cased; nothing
 * here folds, defaults, or repairs a state the runtime does not hold.
 *
 * `unknown` and `loading` are the two facts the document itself cannot carry,
 * and they are deliberately separate: an unknown harness renders NEUTRALLY and
 * gates nothing, while a stale document renders as stale — never as loading.
 * `loading` is true only before the first read of a harness we have never seen.
 */
export interface HarnessStatus {
  /** One row per method the applied document carries, plus native detection. */
  methods: AgentAuthMethodRow[];
  /** The applied launch method (seat rows carry the SERVING seat). */
  applied: HarnessAppliedMethod | null;
  /** The seat rotation would serve next; null under two serveable seats. */
  nextSeatId: string | null;
  /** The seat-rotation toggle; the document defaults it to true. */
  rotate: boolean;
  /** The last observation. Null ONLY when no document exists at all. */
  probe: HarnessProbeStatus | null;
  /** Non-null ONLY when no seat can serve right now. */
  coolingUntil: string | null;
  /** The runtime holds no status document for this harness. */
  unknown: boolean;
  /** The first read is in flight and nothing has ever been observed. */
  loading: boolean;
  /** Re-read the document (the manual-refresh and pane-open boundaries). */
  refresh: () => void;
}

/**
 * Subscribe one harness's status document and render every push.
 *
 * Subscription is the default (spec §4 cell 4, "When the frontend re-reads and
 * re-probes"): the stream is opened on mount and each frame is written straight
 * into the cache, so there is no client polling loop. The `GET /status` read is
 * the fallback where the stream is unavailable — it seeds the first render and
 * is re-issued once if the stream errors or ends, so a machine with no working
 * stream still shows the runtime's truth instead of an empty pane.
 */
export function useHarnessStatus(
  harnessKind: string | null | undefined,
): HarnessStatus {
  const runtime = useAnyHarnessRuntimeContext();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const authToken = runtime.authToken ?? null;
  const runtimeFetch = runtime.fetch;
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  const kind = harnessKind?.trim() ?? "";
  const enabled = runtimeUrl.length > 0 && kind.length > 0;

  const query = useQuery({
    queryKey: anyHarnessAgentAuthStatusKey(runtimeUrl, kind, cacheScopeKey),
    enabled,
    queryFn: async ({ signal }) =>
      getHarnessAuthStatus(resolveRuntimeConnection(runtime), kind, { signal }),
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const connection = {
      runtimeUrl,
      authToken: authToken ?? undefined,
      ...(runtimeFetch ? { fetch: runtimeFetch } : {}),
    };
    // The stream is a per-harness multiplex: every document lands in its own
    // cache entry, so one subscription serves every mounted pane and a change
    // to grok's auth cannot touch codex's entry.
    const writeDocument = (document: AgentAuthStatusDoc) => {
      queryClient.setQueryData(
        anyHarnessAgentAuthStatusKey(
          runtimeUrl,
          document.harness_kind,
          cacheScopeKey,
        ),
        document,
      );
    };
    // A stream that never opened, or one that ended, leaves this pane holding
    // whatever it last read. Re-read ONCE (no retry loop, no polling): the
    // document is the runtime's, and re-reading is the documented fallback.
    const reread = () => {
      void queryClient.invalidateQueries({
        queryKey: anyHarnessAgentAuthStatusKey(runtimeUrl, kind, cacheScopeKey),
        exact: true,
      });
    };
    const handle = openHarnessAuthStatusStream(connection, {
      onEvent: writeDocument,
      onError: reread,
      onClose: reread,
    });
    return () => {
      handle.close();
    };
  }, [authToken, cacheScopeKey, enabled, kind, queryClient, runtimeFetch, runtimeUrl]);

  const refresh = useCallback(() => {
    if (!enabled) {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: anyHarnessAgentAuthStatusKey(runtimeUrl, kind, cacheScopeKey),
      exact: true,
    });
  }, [cacheScopeKey, enabled, kind, queryClient, runtimeUrl]);

  const document = query.data ?? null;
  // A DISABLED query is `status: "pending"` in react-query v5, so the raw flag
  // reports "still loading" for a read that is not running and never will be.
  const loading = query.isPending && query.fetchStatus !== "idle";

  return useMemo(
    () => ({
      methods: document?.methods ?? [],
      applied: document?.applied ?? null,
      nextSeatId: document?.next_seat_id ?? null,
      rotate: document?.rotate ?? true,
      probe: document?.probe ?? null,
      coolingUntil: document?.cooling_until ?? null,
      unknown: document === null,
      loading,
      refresh,
    }),
    [document, loading, refresh],
  );
}

/**
 * The method picker's truth (`GET /methods`) — the rows straight from the
 * harness's status document, never a client-side assembly of what a method
 * "should" be available for.
 */
export function useMethods(
  harnessKind: string | null | undefined,
): AgentAuthMethodRow[] {
  const runtime = useAnyHarnessRuntimeContext();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  const cacheScopeKey = resolveRuntimeCacheScopeKey(runtime);
  const kind = harnessKind?.trim() ?? "";

  const query = useQuery({
    queryKey: anyHarnessAgentAuthMethodsKey(runtimeUrl, kind, cacheScopeKey),
    enabled: runtimeUrl.length > 0 && kind.length > 0,
    queryFn: async ({ signal }) =>
      getHarnessAuthMethods(resolveRuntimeConnection(runtime), kind, { signal }),
  });

  return query.data ?? [];
}
