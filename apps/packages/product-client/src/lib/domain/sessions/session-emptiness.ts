import type {
  SessionActivity,
  SessionExecutionSummary,
  SessionStatus,
  TranscriptState,
} from "@anyharness/sdk";

/**
 * Snapshot of the fields needed to determine whether a session has ever had
 * user work. Intentionally decoupled from the full SessionRuntimeRecord so
 * the predicate stays pure and testable without store dependencies.
 *
 * Runtime event envelopes are deliberately not part of the decision. Fresh
 * sessions receive status and config acknowledgements before the user does any
 * work, and those transport details must not turn an unused chat into a kept
 * chat.
 */
export interface SessionEmptinessSnapshot {
  transcript: Pick<
    TranscriptState,
    "isStreaming" | "pendingInteractions" | "pendingPrompts" | "turnOrder"
  >;
  events: readonly unknown[];
  optimisticPrompt: unknown | null;
  hasAttemptedPrompt: boolean;
  activeGoal: unknown | null;
  executionSummary: Pick<SessionExecutionSummary, "pendingInteractions" | "phase"> | null;
  lastPromptAt: string | null;
  sessionActivity: Pick<
    SessionActivity,
    "agents" | "goal" | "loops" | "processes" | "turn"
  > | null;
  status: SessionStatus | null;
}

/**
 * A session is "empty" when the user has never submitted meaningful work to it:
 * - No transcript turns (no messages sent or received)
 * - No optimistic prompt currently in flight
 * - No prior attempted prompt (even if it failed or was retracted)
 * - No active goal or pending interaction
 *
 * This is used to decide whether a harness switch can replace the session in
 * place rather than leaving an unused tab around.
 */
export function isSessionEmpty(snapshot: SessionEmptinessSnapshot): boolean {
  return (
    snapshot.transcript.turnOrder.length === 0
    && !snapshot.optimisticPrompt
    && !snapshot.hasAttemptedPrompt
    && !snapshot.activeGoal
    && !snapshot.lastPromptAt
    && !hasDurableSessionActivity(snapshot.sessionActivity)
    && snapshot.transcript.pendingInteractions.length === 0
    && snapshot.transcript.pendingPrompts.length === 0
    && (snapshot.executionSummary?.pendingInteractions?.length ?? 0) === 0
  );
}

function hasDurableSessionActivity(
  activity: SessionEmptinessSnapshot["sessionActivity"],
): boolean {
  if (!activity) {
    return false;
  }
  return Boolean(activity.goal)
    || (activity.loops?.length ?? 0) > 0
    || (activity.processes?.length ?? 0) > 0
    || (activity.agents?.length ?? 0) > 0;
}

/**
 * Extended emptiness check that also considers queued prompt intents. A session
 * might have no transcript turns yet but have outbound prompts waiting for
 * materialization — that counts as "user work" and should not be replaced.
 */
export function isSessionEmptyWithIntents(
  snapshot: SessionEmptinessSnapshot,
  promptOutboxCount: number,
): boolean {
  return isSessionEmpty(snapshot) && promptOutboxCount === 0;
}
