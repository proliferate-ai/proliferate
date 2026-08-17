import { useMemo } from "react";
import {
  deriveBackgroundWorkDirty,
  deriveLatestBackgroundWorkFinishSignal,
  type BackgroundWorkFinishSignal,
} from "#product/domain/activity/background-work-finish-signal";
import { useSessionActivityForSession } from "#product/hooks/activity/derived/use-session-activity";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

export interface BackgroundWorkFinishSignalState {
  /** The most recent piece of background work to finish, or null. */
  signal: BackgroundWorkFinishSignal | null;
  /**
   * Whether `signal` is newer than the last time this session's Background
   * work pane was actually open — the source `PanelHeaderEntry`'s `dirty`
   * prop reads (Design Handoff — "Finish signals are a ladder"; Delivery
   * Spec — Background Work Slice 1, rung R5).
   */
  dirty: boolean;
}

const NO_SIGNAL: BackgroundWorkFinishSignalState = { signal: null, dirty: false };

/**
 * Read-side of the finish-signal ladder for `sessionId`. Combines the
 * roster (`useSessionActivityForSession(sessionId)` — processes never leave
 * it, so their `endedAt` is read straight off it) with the cached
 * subagent-finish observation `useBackgroundWorkFinishSignalTracking`
 * writes (subagents DO leave the roster the instant they finish).
 *
 * `sessionId` is an explicit parameter, and — R5 review round 2 (MAJOR) —
 * reads the roster via `useSessionActivityForSession(sessionId)` rather
 * than the active-session-only `useSessionActivity()`: every call site
 * already has its own session identity (a prop, or a locally-computed
 * active id with its own deferred/session-switch semantics), and this hook
 * must agree with THAT one, not silently swap in whatever session happens
 * to be globally active on a given render.
 */
export function useBackgroundWorkFinishSignal(
  sessionId: string | null,
): BackgroundWorkFinishSignalState {
  const activity = useSessionActivityForSession(sessionId);
  const cachedFinishedSubagent = useWorkspaceUiStore((state) =>
    sessionId ? state.backgroundWorkLastFinishedSubagentBySession[sessionId] ?? null : null
  );
  const lastViewedAtMs = useWorkspaceUiStore((state) =>
    sessionId ? state.backgroundWorkLastViewedAtBySession[sessionId] ?? null : null
  );

  return useMemo(() => {
    if (!sessionId) {
      return NO_SIGNAL;
    }
    const signal = deriveLatestBackgroundWorkFinishSignal({
      processes: activity.processes,
      cachedFinishedSubagent,
      lastViewedAtMs,
    });
    const dirty = deriveBackgroundWorkDirty({
      latestFinishAtMs: signal?.atMs ?? null,
      lastViewedAtMs,
    });
    return { signal, dirty };
  }, [sessionId, activity.processes, cachedFinishedSubagent, lastViewedAtMs]);
}
