import type { HotSessionTarget } from "@/lib/domain/sessions/hot-session-policy";
import { getSessionRecord } from "@/stores/sessions/session-records";
import {
  isHotSessionTargetCurrent,
  useSessionIngestStore,
} from "@/stores/sessions/session-ingest-store";

interface EnsureSessionStreamOptions {
  awaitOpen?: boolean;
  openTimeoutMs?: number;
  resumeIfActive?: boolean;
  hydrateBeforeStream?: boolean;
  skipInitialRefresh?: boolean;
  refreshOnStartupReady?: boolean;
  forceReconnect?: boolean;
  reconnectOwner?: "internal" | "external";
  onReconnectNeeded?: () => void;
  isCurrent?: () => boolean;
}

export interface HotSessionIngestManagerDeps {
  ensureSessionStreamConnected: (
    clientSessionId: string,
    options?: EnsureSessionStreamOptions,
  ) => Promise<void>;
  closeSessionSlotStream: (clientSessionId: string) => void;
}

interface ActiveHotStream {
  clientSessionId: string;
  materializedSessionId: string;
  generation: number;
  retryAttempt: number;
  opening: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

const RETRY_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000, 30_000] as const;

const activeStreamsByClientSessionId = new Map<string, ActiveHotStream>();

export function reconcileHotSessions(
  targets: readonly HotSessionTarget[],
  deps: HotSessionIngestManagerDeps,
): void {
  const generation = useSessionIngestStore.getState().setHotTargets(targets);
  const nextTargetIds = new Set(targets.map((target) => target.clientSessionId));

  for (const clientSessionId of activeStreamsByClientSessionId.keys()) {
    if (!nextTargetIds.has(clientSessionId)) {
      closeHotStream(clientSessionId, deps);
    }
  }

  for (const target of targets) {
    if (!target.streamable || !target.materializedSessionId) {
      clearRetry(target.clientSessionId);
      useSessionIngestStore.getState().markWarming(target.clientSessionId);
      continue;
    }
    const streamableTarget = {
      ...target,
      materializedSessionId: target.materializedSessionId,
    };

    const existing = activeStreamsByClientSessionId.get(target.clientSessionId);
    if (
      existing
      && existing.materializedSessionId === target.materializedSessionId
      && existing.generation === generation
      && (existing.opening || existing.retryTimer)
    ) {
      continue;
    }
    if (
      existing
      && existing.materializedSessionId === target.materializedSessionId
      && existing.generation === generation
      && isHotSessionTargetCurrent(
        target.clientSessionId,
        generation,
        target.materializedSessionId,
      )
    ) {
      continue;
    }

    connectHotTarget(streamableTarget, generation, deps, existing?.retryAttempt ?? 0);
  }
}

export function isHotSessionClientId(clientSessionId: string): boolean {
  return !!useSessionIngestStore.getState().targetsByClientSessionId[clientSessionId];
}

export function resetHotSessionIngestManagerForTest(): void {
  for (const stream of activeStreamsByClientSessionId.values()) {
    if (stream.retryTimer) {
      clearTimeout(stream.retryTimer);
    }
  }
  activeStreamsByClientSessionId.clear();
  useSessionIngestStore.getState().clear();
}

function connectHotTarget(
  target: HotSessionTarget & { materializedSessionId: string },
  generation: number,
  deps: HotSessionIngestManagerDeps,
  retryAttempt: number,
): void {
  clearRetry(target.clientSessionId);
  useSessionIngestStore.getState().markWarming(target.clientSessionId);

  const stream: ActiveHotStream = {
    clientSessionId: target.clientSessionId,
    materializedSessionId: target.materializedSessionId,
    generation,
    retryAttempt,
    opening: true,
    retryTimer: null,
  };
  activeStreamsByClientSessionId.set(target.clientSessionId, stream);

  void deps.ensureSessionStreamConnected(target.clientSessionId, {
    awaitOpen: true,
    openTimeoutMs: 2_500,
    resumeIfActive: true,
    hydrateBeforeStream: false,
    skipInitialRefresh: true,
    refreshOnStartupReady: true,
    reconnectOwner: "external",
    onReconnectNeeded: () => {
      const current = activeStreamsByClientSessionId.get(target.clientSessionId);
      scheduleRetry(target, generation, deps, current?.retryAttempt ?? retryAttempt);
    },
    isCurrent: () =>
      isHotSessionTargetCurrent(
        target.clientSessionId,
        generation,
        target.materializedSessionId,
      ),
  }).then(() => {
    if (!isHotSessionTargetCurrent(
      target.clientSessionId,
      generation,
      target.materializedSessionId,
    )) {
      return;
    }
    const current = activeStreamsByClientSessionId.get(target.clientSessionId);
    if (current) {
      current.opening = false;
      current.retryAttempt = 0;
    }
    const record = getSessionRecord(target.clientSessionId);
    if (record?.streamConnectionState === "open") {
      useSessionIngestStore.getState().markCurrentIfContiguous(
        target.clientSessionId,
        record.transcript.lastSeq,
      );
    } else {
      const freshness = useSessionIngestStore.getState()
        .freshnessByClientSessionId[target.clientSessionId]?.freshness;
      if (freshness !== "stale") {
        useSessionIngestStore.getState().markWarming(target.clientSessionId);
      }
    }
  }).catch(() => {
    if (!isHotSessionTargetCurrent(
      target.clientSessionId,
      generation,
      target.materializedSessionId,
    )) {
      return;
    }
    const record = getSessionRecord(target.clientSessionId);
    useSessionIngestStore.getState().markStale(target.clientSessionId, {
      lastAppliedSeq: record?.transcript.lastSeq ?? 0,
      lastObservedSeq: record?.transcript.lastSeq ?? 0,
      gapAfterSeq: null,
      lastErrorAt: new Date().toISOString(),
    });
    scheduleRetry(target, generation, deps, retryAttempt);
  });
}

function scheduleRetry(
  target: HotSessionTarget & { materializedSessionId: string },
  generation: number,
  deps: HotSessionIngestManagerDeps,
  retryAttempt: number,
): void {
  if (!isHotSessionTargetCurrent(
    target.clientSessionId,
    generation,
    target.materializedSessionId,
  )) {
    return;
  }

  const delayMs = RETRY_BACKOFF_MS[Math.min(retryAttempt, RETRY_BACKOFF_MS.length - 1)];
  const stream = activeStreamsByClientSessionId.get(target.clientSessionId);
  if (!stream) {
    return;
  }
  stream.opening = false;
  stream.retryAttempt = retryAttempt + 1;
  stream.retryTimer = setTimeout(() => {
    const current = activeStreamsByClientSessionId.get(target.clientSessionId);
    if (current?.retryTimer) {
      current.retryTimer = null;
    }
    if (!isHotSessionTargetCurrent(
      target.clientSessionId,
      generation,
      target.materializedSessionId,
    )) {
      return;
    }
    connectHotTarget(target, generation, deps, retryAttempt + 1);
  }, delayMs);
}

function closeHotStream(
  clientSessionId: string,
  deps: HotSessionIngestManagerDeps,
): void {
  clearRetry(clientSessionId);
  deps.closeSessionSlotStream(clientSessionId);
  activeStreamsByClientSessionId.delete(clientSessionId);
  useSessionIngestStore.getState().markCold(clientSessionId);
}

function clearRetry(clientSessionId: string): void {
  const stream = activeStreamsByClientSessionId.get(clientSessionId);
  if (stream?.retryTimer) {
    clearTimeout(stream.retryTimer);
    stream.retryTimer = null;
  }
}
