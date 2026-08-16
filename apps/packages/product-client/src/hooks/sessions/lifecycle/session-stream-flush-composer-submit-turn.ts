import type { TranscriptState } from "@anyharness/sdk";

/**
 * Binds the composer_submit renderer-flow (session-stream-flush-apply.ts) to
 * the specific turn the submit actually created, so the flow's finish check
 * cannot be satisfied by an unrelated turn.
 *
 * Without this binding, "does turnOrder's last entry have assistant content"
 * is not scoped to the submitted turn: a reconnect/gap-fill batch that
 * completes an OLDER turn which still happens to be turnOrder's last entry
 * (because the new turn hasn't started yet) would satisfy that check and
 * finish the flow on stale content, recording a bogus duration and silently
 * swallowing the real completion (finish is one-shot).
 *
 * A session has at most one composer_submit in flight at a time (the
 * composer blocks a second concurrent send on the same session), so the
 * first turn id that appears in a batch's `turnOrder` which wasn't present
 * before that batch is, structurally, the turn the in-flight submit created.
 * Rebinding on every newly observed turn (rather than only when unbound)
 * keeps the tracked turn current if a prior submit's binding was never
 * cleared (e.g. the flow was abandoned or pruned as stale before finishing).
 */

interface TurnsSnapshot {
  turnOrder: readonly string[];
  turnsById: TranscriptState["turnsById"];
}

const composerSubmitTurnBySession = new Map<string, string>();

export function resolveComposerSubmitTargetTurnId(
  sessionId: string,
  before: TurnsSnapshot,
  after: TurnsSnapshot,
): string | null {
  for (const turnId of after.turnOrder) {
    if (!before.turnsById[turnId]) {
      composerSubmitTurnBySession.set(sessionId, turnId);
    }
  }
  return composerSubmitTurnBySession.get(sessionId) ?? null;
}

export function clearComposerSubmitTargetTurn(sessionId: string): void {
  composerSubmitTurnBySession.delete(sessionId);
}

export function resetComposerSubmitTurnTrackingForTest(): void {
  composerSubmitTurnBySession.clear();
}
