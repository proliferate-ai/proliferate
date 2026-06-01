import {
  resolveSessionViewState,
} from "@proliferate/product-domain/sessions/activity";
import { logLatency } from "@/lib/infra/measurement/debug-latency";

export interface FlushAwareSessionStreamHandle {
  close(): void;
  flushPendingEvents(): void;
}

export interface SessionStreamStatusDeps {
  getSessionStreamHandle(sessionId: string): FlushAwareSessionStreamHandle | null;
  isPendingSessionId(sessionId: string): boolean;
}

export interface SessionStreamDetachDeps {
  getMaterializedSessionId(clientSessionId: string): string | null;
  getSessionStreamHandle(sessionId: string): FlushAwareSessionStreamHandle | null;
  closeSessionStreamHandle(sessionId: string, handle: FlushAwareSessionStreamHandle): void;
  findClientSessionIdByMaterializedSessionId(materializedSessionId: string): string | null;
  patchSessionStreamConnectionState(
    clientSessionId: string,
    streamConnectionState: "disconnected",
  ): void;
}

type SessionStreamPruningRecord =
  Parameters<typeof resolveSessionViewState>[0]
  & { materializedSessionId?: string | null };

export interface SessionStreamPruningDeps
  extends SessionStreamDetachDeps,
    SessionStreamStatusDeps {
  getSessionRecords(): Record<string, SessionStreamPruningRecord>;
  flushAllSessionStreamHandles(): void;
}

export function createPendingSessionId(agentKind: string): string {
  return `client-session:${agentKind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function collectInactiveSessionStreamIds(
  sessions: Record<string, SessionStreamPruningRecord>,
  deps: SessionStreamStatusDeps,
  options?: {
    preserveSessionIds?: Iterable<string>;
  },
): string[] {
  const preservedSessionIds = new Set(options?.preserveSessionIds ?? []);
  const prunableSessionIds: string[] = [];

  for (const [sessionId, record] of Object.entries(sessions)) {
    if (
      !record.materializedSessionId
      || !deps.getSessionStreamHandle(record.materializedSessionId)
      || deps.isPendingSessionId(sessionId)
      || preservedSessionIds.has(sessionId)
    ) {
      continue;
    }

    const viewState = resolveSessionViewState(record);
    if (viewState === "working" || viewState === "needs_input") {
      continue;
    }

    prunableSessionIds.push(sessionId);
  }

  return prunableSessionIds;
}

export function detachAndCloseSessionStreams(
  sessionIds: Iterable<string>,
  deps: SessionStreamDetachDeps,
): number {
  const uniqueSessionIds = Array.from(new Set(sessionIds));
  if (uniqueSessionIds.length === 0) {
    return 0;
  }

  const streams: { sessionId: string; handle: FlushAwareSessionStreamHandle }[] = [];
  for (const sessionId of uniqueSessionIds) {
    const materializedSessionId = deps.getMaterializedSessionId(sessionId);
    const handle = materializedSessionId
      ? deps.getSessionStreamHandle(materializedSessionId)
      : null;
    if (!materializedSessionId || !handle) {
      continue;
    }
    streams.push({ sessionId: materializedSessionId, handle });
  }

  if (streams.length === 0) {
    return 0;
  }

  for (const { sessionId, handle } of streams) {
    deps.closeSessionStreamHandle(sessionId, handle);
    const clientSessionId = deps.findClientSessionIdByMaterializedSessionId(sessionId)
      ?? sessionId;
    deps.patchSessionStreamConnectionState(clientSessionId, "disconnected");
  }
  return streams.length;
}

export function pruneInactiveSessionStreams(
  deps: SessionStreamPruningDeps,
  options?: {
    preserveSessionIds?: Iterable<string>;
  },
): string[] {
  deps.flushAllSessionStreamHandles();
  const prunableSessionIds = collectInactiveSessionStreamIds(
    deps.getSessionRecords(),
    deps,
    options,
  );
  if (prunableSessionIds.length === 0) {
    return [];
  }

  detachAndCloseSessionStreams(prunableSessionIds, deps);
  logLatency("session.stream.pruned", {
    closedSessionCount: prunableSessionIds.length,
  });
  return prunableSessionIds;
}
