import { useEffect, useRef } from "react";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";
import { useSessionActivityForSession } from "#product/hooks/activity/derived/use-session-activity";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";

/**
 * Write side of the finish-signal ladder's subagent tracking. Native
 * subagents leave the roster the instant they finish (locked design,
 * `domain/activity/chips.ts`), so the ONLY way to ever learn a subagent
 * finished is to notice it disappearing between two roster snapshots — there
 * is nothing to re-derive later from a durable field, unlike a process's
 * `endedAt`.
 *
 * Mount this once, somewhere that stays mounted for the whole time a
 * session is active regardless of which right-panel tool tab is showing
 * (`SessionTranscriptPane` — the transcript surface, not `BackgroundWorkPane`,
 * which unmounts whenever a different tool is selected).
 *
 * `sessionId` is an explicit parameter, read via
 * `useSessionActivityForSession(sessionId)` rather than the active-session-
 * only `useSessionActivity()` (R5 review round 2 — MAJOR: the previous
 * version silently ignored this parameter and always read whatever session
 * was globally active, which is a real API-contract bug even though it
 * happened to be a no-op today — see below). This makes the hook honor its
 * own signature: give it any `sessionId` and it tracks exactly that
 * session's roster, regardless of what else is active.
 *
 * Two things this hook does NOT do, disclosed rather than silently patched
 * over:
 *
 * 1. **It is mounted once, for whichever session `SessionTranscriptPane` is
 *    currently rendering — always the active session in practice**
 *    (`SessionTranscriptPane` passes `immediatePaneState.activeSessionId`,
 *    which is itself derived from `useActiveSessionId()`). A subagent that
 *    finishes in a DIFFERENT session while the user is looking at this one
 *    is therefore not observed until the user switches to it — at which
 *    point this hook starts tracking it and correctly detects anything that
 *    vanished while away (comparing against whatever it last recorded for
 *    that session, however old). This is not a client-data-availability gap
 *    — `useSessionActivityForSession` genuinely reads a per-session slice,
 *    and `lib/domain/sessions/hot-session-policy.ts` keeps several
 *    non-active sessions' slices live (open tabs, sessions with an
 *    in-flight turn, cross-workspace running sessions) — it is a mount-
 *    cardinality choice: exactly one tracker, tied to the one session whose
 *    Background work pane could ever actually be shown. Extending this to
 *    watch every hot session concurrently would need a tracker instance per
 *    hot session and has no UI payoff today, because rung 1/2 of the ladder
 *    (`use-right-panel-controller.ts`'s dot, `BackgroundWorkPane`'s banner)
 *    are ALSO both scoped to `useActiveSessionId()` only — there is no
 *    right-panel surface that renders a non-active session's dot or banner
 *    for this multi-tracker mode to feed. Compatible with ruled D6 (the
 *    signal is per-session, no workspace-level persistence): a session's
 *    signal only has to be correct once that session is the one being
 *    viewed, which is exactly when this hook is watching it.
 * 2. **The cached `detectedAtMs` is NOT the subagent's real finish time** —
 *    see `domain/activity/background-work-finish-signal.ts`'s module
 *    docstring for how ranking against a process's real `endedAt` avoids
 *    letting a stale detection outrank a genuinely more recent finish.
 */
export function useBackgroundWorkFinishSignalTracking(sessionId: string | null): void {
  const activity = useSessionActivityForSession(sessionId);
  const recordBackgroundWorkFinishedSubagentForSession = useWorkspaceUiStore(
    (state) => state.recordBackgroundWorkFinishedSubagentForSession,
  );
  const previousAgentsBySessionRef = useRef<Map<string, Map<string, ActivitySubagentWire>>>(
    new Map(),
  );

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const currentById = new Map(activity.agents.map((agent) => [agent.id, agent] as const));
    const previousById = previousAgentsBySessionRef.current.get(sessionId);

    if (previousById) {
      for (const [id, previousAgent] of previousById) {
        if (previousAgent.status.status !== "running") {
          // Already accounted for on an earlier pass.
          continue;
        }
        const currentAgent = currentById.get(id);
        if (!currentAgent) {
          // Vanished entirely — the last-seen (running) snapshot is the only
          // record that will ever exist. `Date.now()` here is a DETECTION
          // time, not a finish time — see the module docstring above.
          recordBackgroundWorkFinishedSubagentForSession(sessionId, previousAgent, Date.now());
        } else if (currentAgent.status.status !== "running") {
          // Still present for this one tick with its real final status —
          // cache THAT instead of the stale running snapshot. Still a
          // detection time, not a finish time.
          recordBackgroundWorkFinishedSubagentForSession(sessionId, currentAgent, Date.now());
        }
      }
    }

    previousAgentsBySessionRef.current.set(sessionId, currentById);
  }, [sessionId, activity.agents, recordBackgroundWorkFinishedSubagentForSession]);
}
