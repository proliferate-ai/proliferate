/**
 * UX-latency R14: in-flight dedupe for full session-open (non-incremental)
 * hydrations, keyed by session id.
 *
 * Two callers can now race for the same session's transcript — the
 * workspace-open bootstrap fires a fire-and-forget kickoff (hydration moved off
 * the critical path) and SessionTranscriptPane's self-hydration effect fires
 * independently. Without dedupe both would fetch AND both would apply history
 * to the stores and emit the session_open flow marks twice. Sharing the whole
 * operation (fetch + replay + store + marks) guarantees exactly one fetch and
 * one apply; the second caller receives the first caller's result.
 *
 * Only full opens dedupe — incremental append/prepend fetches (afterSeq/
 * beforeSeq) target different ranges and must not share.
 *
 * Extracted from use-session-history-hydration.ts to keep that hook under the
 * frontend-structure line threshold.
 */
const inFlightSessionOpenHydrations = new Map<string, Promise<boolean>>();

interface SessionOpenDedupeOptions {
  afterSeq?: number;
  beforeSeq?: number;
}

/**
 * Runs `run` under the session-open dedupe when the options describe a full
 * open; otherwise runs it directly (incremental fetches are never shared).
 */
export function dedupeSessionOpenHydration(
  sessionId: string,
  options: SessionOpenDedupeOptions | undefined,
  run: () => Promise<boolean>,
): Promise<boolean> {
  const isSessionOpenHydration =
    (options?.afterSeq ?? null) === null && (options?.beforeSeq ?? null) === null;
  if (!isSessionOpenHydration) {
    return run();
  }
  const inFlight = inFlightSessionOpenHydrations.get(sessionId);
  if (inFlight) {
    return inFlight;
  }
  const promise = run();
  inFlightSessionOpenHydrations.set(sessionId, promise);
  void promise.finally(() => {
    if (inFlightSessionOpenHydrations.get(sessionId) === promise) {
      inFlightSessionOpenHydrations.delete(sessionId);
    }
  });
  return promise;
}

export function resetSessionHistoryHydrationInFlightForTest(): void {
  inFlightSessionOpenHydrations.clear();
}
