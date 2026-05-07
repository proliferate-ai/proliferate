import type { HotSessionTarget } from "@/lib/domain/sessions/hot-session-policy";
import { useSessionIngestStore } from "@/stores/sessions/session-ingest-store";

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

interface HotSessionIngestStateDeps {
  setHotTargets: (targets: readonly HotSessionTarget[]) => number;
  markWarming: (clientSessionId: string) => void;
  markCurrentIfContiguous: (clientSessionId: string, lastAppliedSeq: number) => void;
  markStale: (
    clientSessionId: string,
    patch?: {
      lastAppliedSeq?: number;
      lastObservedSeq?: number;
      gapAfterSeq?: number | null;
      lastErrorAt?: string | null;
    },
  ) => void;
  markCold: (clientSessionId: string) => void;
  getFreshness: (clientSessionId: string) => "current" | "warming" | "stale" | "cold" | null;
  isTargetCurrent: (
    clientSessionId: string,
    generation: number,
    materializedSessionId: string | null,
  ) => boolean;
  getSessionRecord: (clientSessionId: string) => {
    streamConnectionState: string | null;
    lastSeq: number;
  } | null;
}

export interface HotSessionIngestManagerDeps {
  ensureSessionStreamConnected: (
    clientSessionId: string,
    options?: EnsureSessionStreamOptions,
  ) => Promise<void>;
  closeSessionSlotStream: (clientSessionId: string) => void;
  state: HotSessionIngestStateDeps;
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
  const generation = deps.state.setHotTargets(targets);
  const nextTargetIds = new Set(targets.map((target) => target.clientSessionId));

  for (const clientSessionId of activeStreamsByClientSessionId.keys()) {
    if (!nextTargetIds.has(clientSessionId)) {
      closeHotStream(clientSessionId, deps);
    }
  }

  for (const target of targets) {
    if (!target.streamable || !target.materializedSessionId) {
      clearRetry(target.clientSessionId);
      deps.state.markWarming(target.clientSessionId);
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
      && deps.state.isTargetCurrent(
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
  deps.state.markWarming(target.clientSessionId);

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
      deps.state.isTargetCurrent(
        target.clientSessionId,
        generation,
        target.materializedSessionId,
      ),
  }).then(() => {
    if (!deps.state.isTargetCurrent(
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
    const record = deps.state.getSessionRecord(target.clientSessionId);
    if (record?.streamConnectionState === "open") {
      deps.state.markCurrentIfContiguous(
        target.clientSessionId,
        record.lastSeq,
      );
      return;
    }
    if (deps.state.getFreshness(target.clientSessionId) !== "stale") {
      deps.state.markWarming(target.clientSessionId);
    }
  }).catch(() => {
    if (!deps.state.isTargetCurrent(
      target.clientSessionId,
      generation,
      target.materializedSessionId,
    )) {
      return;
    }
    const record = deps.state.getSessionRecord(target.clientSessionId);
    deps.state.markStale(target.clientSessionId, {
      lastAppliedSeq: record?.lastSeq ?? 0,
      lastObservedSeq: record?.lastSeq ?? 0,
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
  if (!deps.state.isTargetCurrent(
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
    if (!deps.state.isTargetCurrent(
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
  deps.state.markCold(clientSessionId);
}

function clearRetry(clientSessionId: string): void {
  const stream = activeStreamsByClientSessionId.get(clientSessionId);
  if (stream?.retryTimer) {
    clearTimeout(stream.retryTimer);
    stream.retryTimer = null;
  }
}
