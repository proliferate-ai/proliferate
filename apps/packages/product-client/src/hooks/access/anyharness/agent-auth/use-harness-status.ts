import type { AgentAuthMethodRow, AgentAuthStatusDoc } from "@anyharness/sdk";
import {
  anyHarnessAgentAuthMethodsKey,
  anyHarnessAgentAuthStatusKey,
  resolveRuntimeCacheScopeKey,
  resolveRuntimeConnection,
  useAnyHarnessRuntimeContext,
  type AnyHarnessClientConnection,
} from "@anyharness/sdk-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import {
  getHarnessAuthMethods,
  getHarnessAuthStatus,
  openHarnessAuthStatusStream,
  type HarnessAuthStatusStreamHandle,
} from "#product/lib/access/anyharness/agent-auth";

/**
 * The re-subscribe schedule after a stream end: 1s, doubling per consecutive
 * end, capped at 30s. The cap is what makes a genuinely-down runtime cheap —
 * at worst one failed open per 30s per pane, never a hammer loop — while a
 * stream that actually OPENS resets the schedule so a one-off lag-end costs a
 * single second of pushlessness.
 */
const STREAM_REOPEN_BASE_DELAY_MS = 1_000;
const STREAM_REOPEN_MAX_DELAY_MS = 30_000;

/** The applied-method tag on a status document. */
export type HarnessAppliedMethod = NonNullable<AgentAuthStatusDoc["applied"]>;
/** The serve-stale probe observation on a status document. */
export type HarnessProbeStatus = AgentAuthStatusDoc["probe"];

/**
 * The ONE access-layer seam for a harness's auth truth (agent_auth spec §4
 * cell 4). Every field below IS the status document, camel-cased; nothing here
 * folds, defaults, or repairs a state the runtime does not hold.
 *
 * Every field has a reader, and each fact is reachable through exactly ONE of
 * them — a second copy of a fact is the multiple-sources bug this slice exists
 * to close. So, deliberately absent:
 *
 * - `unknown` — "the runtime holds no document" IS `probe === null` (the
 *   document always carries a probe block), which is what presentation reads.
 * - `rotate` — the seat-rotation toggle's authority is the cloud
 *   `agent_auth_harness_settings` rider (`useSeatRotateSetting`), the only side
 *   that can be written; the document's copy is the DELIVERED echo of that
 *   write, so rendering the switch from it would show delivery, not intent.
 * - `methods` — method rows are `useMethods`'s job (door 2, the spec's named
 *   seam for them); a second cache entry of the same rows is a second source.
 * - `loading` — the spec's rule is that a stale document renders as stale,
 *   never as loading. `refreshing` is the honest fact: a re-read is in flight.
 */
export interface HarnessStatus {
  /** The applied launch method (seat rows carry the SERVING seat). */
  applied: HarnessAppliedMethod | null;
  /** The seat rotation would serve next; null under two serveable seats. */
  nextSeatId: string | null;
  /** The last observation. Null ONLY when no document exists at all. */
  probe: HarnessProbeStatus | null;
  /** Non-null ONLY when no seat can serve right now. */
  coolingUntil: string | null;
  /** A re-read of the document is in flight (the refresh affordance's spinner). */
  refreshing: boolean;
  /** Re-read the document (the manual-refresh and pane-open boundaries). */
  refresh: () => void;
}

/**
 * Subscribe one harness's status document and render every push.
 *
 * Subscription is the default (spec §4 cell 4, "When the frontend re-reads and
 * re-probes"): the stream is opened on mount and each frame is written straight
 * into the cache, so there is no client polling loop. The `GET /status` read
 * seeds the first render, and when the stream errors or ends it is re-issued
 * ONCE to cover the gap — the runtime deliberately ends a subscriber that lags
 * its broadcast (no seq/replay, so staying subscribed would silently lose
 * events), so an end is expected in a throttled window's life. Recovery of the
 * pushes themselves is the re-subscribe below, on a capped backoff: without it
 * a pane that lagged once would degrade to a static snapshot for the rest of
 * its mount.
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

  // ONE connection for the read AND the subscription, transport override
  // included: on cloud that override is the only thing carrying the sandbox
  // gateway's authorization header, and a stream opened without it 401s behind a
  // hook that has no polling fallback. Memoised so the effect below keys off the
  // connection's CONTENT, not the context object's per-render identity.
  const connection = useMemo<AnyHarnessClientConnection>(
    () => ({ runtimeUrl, authToken: authToken ?? undefined, fetch: runtimeFetch }),
    [authToken, runtimeFetch, runtimeUrl],
  );

  const query = useQuery({
    queryKey: anyHarnessAgentAuthStatusKey(runtimeUrl, kind, cacheScopeKey),
    enabled,
    queryFn: async ({ signal }) =>
      getHarnessAuthStatus(connection, kind, { signal }),
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
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
    // whatever it last read. Re-read ONCE per end (no read loop, no polling
    // interval): the read covers whatever pushed while unsubscribed, and the
    // scheduled re-open below is what restores the pushes themselves.
    const reread = () => {
      void queryClient.invalidateQueries({
        queryKey: anyHarnessAgentAuthStatusKey(runtimeUrl, kind, cacheScopeKey),
        exact: true,
      });
    };

    let disposed = false;
    let reopenTimer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveEnds = 0;
    let handle: HarnessAuthStatusStreamHandle | null = null;

    const open = () => {
      if (disposed) {
        return;
      }
      // ONE recovery per subscription, even if a reader ever surfaced both an
      // error and a close for the same stream: two would double the re-read
      // and stack two re-open timers.
      let recovered = false;
      const recover = () => {
        if (disposed || recovered) {
          return;
        }
        recovered = true;
        reread();
        // `2 ** ends` runs away unbounded, so cap FIRST: past ~2^53 the
        // doubling is Infinity, and `Math.min` still answers the cap.
        const delay = Math.min(
          STREAM_REOPEN_BASE_DELAY_MS * 2 ** consecutiveEnds,
          STREAM_REOPEN_MAX_DELAY_MS,
        );
        consecutiveEnds += 1;
        reopenTimer = setTimeout(() => {
          reopenTimer = null;
          open();
        }, delay);
      };
      handle = openHarnessAuthStatusStream(connection, {
        // An OPENED stream (a 200, frames flowing) resets the schedule: the
        // next lag-end waits 1s again instead of inheriting a 30s delay.
        onOpen: () => {
          consecutiveEnds = 0;
        },
        onEvent: writeDocument,
        onError: recover,
        onClose: recover,
      });
    };

    open();

    return () => {
      // Unmount (or a deps change) must cancel a pending re-open: a timer that
      // survives this cleanup would resubscribe a pane that no longer exists.
      disposed = true;
      if (reopenTimer !== null) {
        clearTimeout(reopenTimer);
        reopenTimer = null;
      }
      handle?.close();
    };
  }, [cacheScopeKey, connection, enabled, kind, queryClient, runtimeUrl]);

  const refresh = useCallback(() => {
    if (!enabled) {
      return;
    }
    // The pane-open and manual-refresh boundaries re-read status AND methods
    // (spec §4 cell 4): the method rows are the same runtime pass, so refreshing
    // one while the other keeps a stale row is how the two drift apart.
    void queryClient.invalidateQueries({
      queryKey: anyHarnessAgentAuthStatusKey(runtimeUrl, kind, cacheScopeKey),
      exact: true,
    });
    void queryClient.invalidateQueries({
      queryKey: anyHarnessAgentAuthMethodsKey(runtimeUrl, kind, cacheScopeKey),
      exact: true,
    });
  }, [cacheScopeKey, enabled, kind, queryClient, runtimeUrl]);

  const document = query.data ?? null;

  return useMemo(
    () => ({
      applied: document?.applied ?? null,
      nextSeatId: document?.next_seat_id ?? null,
      probe: document?.probe ?? null,
      coolingUntil: document?.cooling_until ?? null,
      // A DISABLED query is `fetchStatus: "idle"` in react-query v5, so this is
      // never true for a read that is not running and never will be.
      refreshing: query.fetchStatus === "fetching",
      refresh,
    }),
    [document, query.fetchStatus, refresh],
  );
}

/**
 * The method picker's truth (`GET /methods`) — the rows straight from the
 * harness's status document, never a client-side assembly of what a method
 * "should" be available for.
 *
 * This is the ONE place method rows enter the client (the status hook
 * deliberately does not re-expose the document's copy of them). Read by the
 * picker: the native row's `detected` is the machine's answer to "does a working
 * login already exist here", which is what the CLI card can honestly say. Its
 * re-read boundaries are the pane-open and manual-refresh ones, which is why
 * `useHarnessStatus().refresh()` invalidates this key too.
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
