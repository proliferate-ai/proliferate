import type { SessionEventEnvelope } from "@anyharness/sdk";
import type {
  DevSSEEventRecord,
  DevSSEEventStatus,
} from "@/lib/infra/debug/dev-sse-event-record";
import { sanitizeDevSSEEnvelope } from "@/lib/infra/debug/dev-sse-envelope-sanitizer";
import { logDevTranscriptPhaseEvent } from "@/lib/infra/debug/dev-transcript-phase-log";

export function logDevSSEEvent(
  sessionId: string,
  envelope: SessionEventEnvelope,
  status: DevSSEEventStatus,
): void {
  if (!import.meta.env.DEV) {
    return;
  }

  const debugGlobal = globalThis as typeof globalThis & {
    __APOLLO_SSE_EVENTS__?: DevSSEEventRecord[];
  };

  const record: DevSSEEventRecord = {
    sessionId,
    receivedAt: new Date().toISOString(),
    status,
    envelope: sanitizeDevSSEEnvelope(envelope),
  };

  const existing = debugGlobal.__APOLLO_SSE_EVENTS__ ?? [];
  debugGlobal.__APOLLO_SSE_EVENTS__ = [...existing.slice(-499), record];
  logDevTranscriptPhaseEvent(sessionId, envelope, status);
}
