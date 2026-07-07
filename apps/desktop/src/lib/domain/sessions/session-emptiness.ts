import type { TranscriptState } from "@anyharness/sdk";

/**
 * Snapshot of the fields needed to determine whether a session has ever had
 * user work. Intentionally decoupled from the full SessionRuntimeRecord so
 * the predicate stays pure and testable without store dependencies.
 *
 * `events` are the raw session event envelopes from the runtime stream. A
 * session that has received any events has been connected to a live runtime and
 * may have had system-level work (config acknowledgements, status changes) even
 * without user-initiated turns — it should not be silently replaced in place.
 */
export interface SessionEmptinessSnapshot {
  transcript: Pick<TranscriptState, "turnOrder">;
  events: readonly unknown[];
  optimisticPrompt: unknown | null;
  hasAttemptedPrompt: boolean;
}

/**
 * A session is "empty" when the user has never submitted meaningful work to it:
 * - No transcript turns (no messages sent or received)
 * - No runtime stream events received (no system-level work has occurred)
 * - No optimistic prompt currently in flight
 * - No prior attempted prompt (even if it failed or was retracted)
 *
 * This is used to decide whether a harness switch can replace the session in
 * place rather than leaving an unused tab around.
 */
export function isSessionEmpty(snapshot: SessionEmptinessSnapshot): boolean {
  return (
    snapshot.transcript.turnOrder.length === 0
    && snapshot.events.length === 0
    && !snapshot.optimisticPrompt
    && !snapshot.hasAttemptedPrompt
  );
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
