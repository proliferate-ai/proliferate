import { useEffect, useLayoutEffect, useRef } from "react";
import { listRuntimeWorkspaces } from "#product/lib/access/anyharness/workspaces";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

// Named exception (does not sit on the `cadence` scale): 4s falls strictly
// between `cadence.fastMs` (1s) and `cadence.standardMs` (5s). Snapping down
// to fast would tighten (forbidden). Snapping up to standard is the closer
// option, but this is the reconciler of last resort for the sidebar-state
// contract (§9.5): it only ever polls while a workspace row is optimistically
// hidden pending an archive confirmation the user can still Undo, so the last
// second before a timed-out attempt gets reconciled is exactly the window
// where an Undo raced a crash-before-response. Kept as its own named constant
// rather than stretching that window (UX Latency + Transitions ADR §4.7,
// Rung 6, Q8).
const ARCHIVE_PENDING_POLL_INTERVAL_MS = 4_000;

export interface UseArchivePendingReconcilerOptions {
  /** The optimistic-hide set: rows hidden with an archive POST in flight or
   * genuinely unknown (timed out). Polling only runs while this is non-empty. */
  pendingIds: ReadonlySet<string>;
  /** The server confirmed this id archived. Fires T1 at confirmation time —
   * the timeout-then-success case must still leave the user an Undo. */
  onConfirmedArchived: (workspaceId: string) => void;
  /** The server still reports this id active: the archive attempt never
   * actually landed (e.g. crash before response). Reinstate with no toast. */
  onReinstated: (workspaceId: string) => void;
  pollIntervalMs?: number;
}

/**
 * The reconciler of last resort the ADR's sidebar-state contract depends on
 * (§9.5): no standing lifecycle-filtered poll exists elsewhere in the client,
 * so a timed-out archive on an otherwise-idle client would keep its row
 * hidden forever without this. Polls `lifecycle=all` only while at least one
 * id is pending, and settles each pending id against the server's own
 * `lifecycleState` — never against client-side inference.
 */
export function useArchivePendingReconciler(options: UseArchivePendingReconcilerOptions): void {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const pollIntervalMs = options.pollIntervalMs ?? ARCHIVE_PENDING_POLL_INTERVAL_MS;

  const callbacksRef = useRef(options);
  useLayoutEffect(() => {
    callbacksRef.current = options;
  });

  // A stable, order-independent key so the polling effect restarts only when
  // the pending SET actually changes membership, not on every render that
  // passes a structurally-equal-but-newly-allocated Set.
  const pendingKey = Array.from(options.pendingIds).sort().join(",");

  useEffect(() => {
    if (options.pendingIds.size === 0) {
      return undefined;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pollInFlight = false;

    const schedule = () => {
      if (cancelled) {
        return;
      }
      timer = setTimeout(poll, pollIntervalMs);
    };

    const poll = () => {
      timer = null;
      if (cancelled || pollInFlight) {
        return;
      }
      pollInFlight = true;
      void listRuntimeWorkspaces({ runtimeUrl }, "all")
        .then((workspaces) => {
          if (cancelled) {
            return;
          }
          const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
          for (const id of callbacksRef.current.pendingIds) {
            const workspace = byId.get(id);
            if (!workspace) {
              // Unknown to the server (e.g. a raced purge): leave pending
              // rather than guess.
              continue;
            }
            if (workspace.lifecycleState === "archived") {
              callbacksRef.current.onConfirmedArchived(id);
            } else if (workspace.lifecycleState === "active") {
              callbacksRef.current.onReinstated(id);
            }
          }
        })
        .catch(() => {
          // Transient network error: try again next tick rather than give up.
        })
        .finally(() => {
          pollInFlight = false;
          schedule();
        });
    };

    schedule();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pendingKey is the intentional restart signal
  }, [pendingKey, pollIntervalMs, runtimeUrl]);
}
