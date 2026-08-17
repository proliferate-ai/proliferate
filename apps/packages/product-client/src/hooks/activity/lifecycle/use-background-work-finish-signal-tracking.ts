import { useEffect, useRef } from "react";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";
import { useSessionActivity } from "#product/hooks/activity/derived/use-session-activity";
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
 * which unmounts whenever a different tool is selected). The roster data
 * itself lives in the session directory store and keeps folding forward
 * from SSE independent of any UI being mounted; this hook only needs to be
 * present to OBSERVE the transition and cache it.
 *
 * `sessionId` is an explicit parameter — see the note on
 * `useBackgroundWorkFinishSignal` for why this does not re-derive it via
 * `useActiveSessionId()` internally.
 */
export function useBackgroundWorkFinishSignalTracking(sessionId: string | null): void {
  const activity = useSessionActivity();
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
          // record that will ever exist.
          recordBackgroundWorkFinishedSubagentForSession(sessionId, previousAgent, Date.now());
        } else if (currentAgent.status.status !== "running") {
          // Still present for this one tick with its real final status —
          // cache THAT instead of the stale running snapshot.
          recordBackgroundWorkFinishedSubagentForSession(sessionId, currentAgent, Date.now());
        }
      }
    }

    previousAgentsBySessionRef.current.set(sessionId, currentById);
  }, [sessionId, activity.agents, recordBackgroundWorkFinishedSubagentForSession]);
}
