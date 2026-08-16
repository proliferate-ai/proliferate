import { abandonRendererFlow } from "#product/lib/infra/diagnostics/renderer-flow-timing";

/**
 * UX-latency R1: session_open renderer-flow instrumentation helpers for the
 * use-session-history-hydration full-(non-incremental)-hydration path.
 *
 * Extracted from use-session-history-hydration.ts so that hook stays under
 * the frontend-structure line threshold; behavior is unchanged. The stage
 * marks themselves (beginRendererFlow / markRendererFlowShellCommitted /
 * markRendererFlowDataReady / finishRendererFlow) are still imported and
 * called directly in use-session-history-hydration.ts per the renderer flow
 * wiring gate (renderer-flow-timing-wiring.test.ts asserts those calls live
 * on the flow's entry file); only their param-object construction and the
 * abandon path live here.
 *
 * The transcript slot already exists by the time a full hydration begins, so
 * the shell is committed immediately after begin. NOTE: intent_to_shell_ms is
 * ~0 by construction for session_open (intent and shell fire back to back);
 * the meaningful timings are shell_to_data (the history fetch) and
 * data_to_stable (replay + store + mount).
 *
 * UX-latency R1 (Q17): the full-hydration path is the session_open flow and
 * emits ONLY through the renderer flow-timing family. The
 * `session_history_initial_hydrate` measurement operation and the
 * `logLatency("session.history.rehydrate.success")` emit that used to run
 * here were the parallel layer the ADR gate forbids, so they are skipped on
 * this path; their phase timings are rerouted onto the renderer marks
 * (event_count on data_ready, replay/store/mount deltas on content_stable).
 * Incremental append/prepend hydrations are out of scope and keep the
 * finer-grained history-apply measurement operation.
 */

export function buildSessionOpenBeginParams(sessionId: string) {
  return {
    kind: "session_open" as const,
    correlationKey: sessionId,
    correlation: { sessionId },
  };
}

export function buildSessionOpenShellCommittedParams(sessionId: string) {
  return { kind: "session_open" as const, correlationKey: sessionId };
}

export function buildSessionOpenDataReadyParams(sessionId: string, eventCount: number) {
  return {
    kind: "session_open" as const,
    correlationKey: sessionId,
    detail: { event_count: eventCount },
  };
}

export interface SessionOpenFlowFinishTimings {
  eventCount: number;
  replayStartedAt: number;
  storeStartedAt: number;
  mountStartedAt: number;
  finishedAt: number;
}

export function buildSessionOpenFinishParams(
  sessionId: string,
  timings: SessionOpenFlowFinishTimings,
) {
  return {
    kind: "session_open" as const,
    correlationKey: sessionId,
    detail: {
      event_count: timings.eventCount,
      replay_ms: Math.round(timings.storeStartedAt - timings.replayStartedAt),
      store_ms: Math.round(timings.mountStartedAt - timings.storeStartedAt),
      mount_ms: Math.round(timings.finishedAt - timings.mountStartedAt),
    },
  };
}

export function markSessionOpenFlowAbandoned(sessionId: string, reason: string): void {
  abandonRendererFlow({
    kind: "session_open",
    correlationKey: sessionId,
    reason,
  });
}
