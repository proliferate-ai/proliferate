import type { HotSessionTarget } from "@/lib/domain/sessions/hot-session-policy";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import { useSessionIngestStore } from "@/stores/sessions/session-ingest-store";

interface EnsureSessionStreamOptions {
  awaitOpen?: boolean;
  openTimeoutMs?: number;
  resumeIfActive?: boolean;
  allowColdIdleNoStream?: boolean;
  hydrateBeforeStream?: boolean;
  skipInitialRefresh?: boolean;
  refreshOnStartupReady?: boolean;
  forceReconnect?: boolean;
  reconnectOwner?: "internal" | "external";
  onReconnectNeeded?: () => void;
  isCurrent?: () => boolean;
}

interface HotSessionIngestStateDeps {
  setHotTargets: (targets: readonly HotSessionTarget[]) => void;
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
  isTargetCurrent: (clientSessionId: string, materializedSessionId: string | null) => boolean;
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
  openToken: symbol;
  reason: HotSessionTarget["reason"];
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
  deps.state.setHotTargets(targets);
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
      && deps.state.isTargetCurrent(target.clientSessionId, target.materializedSessionId)
    ) {
      if (target.reason === "selected" && existing.reason !== "selected") {
        connectHotTarget(streamableTarget, deps, existing.retryAttempt, existing.openToken);
        continue;
      }
      existing.reason = target.reason;
      // Self-heal: a prior connect may have declined to open a stream (e.g.
      // the cold-idle skip) and left this entry registered with nothing in
      // flight. Without this check the session stays streamless even after
      // it becomes active again — a prompt sent to it dispatches fine but
      // its reply never arrives until the user switches sessions.
      if (!existing.opening && !existing.retryTimer) {
        const record = deps.state.getSessionRecord(target.clientSessionId);
        const streamAlive = record?.streamConnectionState === "open"
          || record?.streamConnectionState === "connecting";
        if (!streamAlive) {
          connectHotTarget(streamableTarget, deps, 0, existing.openToken);
        }
      }
      continue;
    }

    connectHotTarget(streamableTarget, deps, existing?.retryAttempt ?? 0);
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
  deps: HotSessionIngestManagerDeps,
  retryAttempt: number,
  preservedOpenToken?: symbol,
): void {
  clearRetry(target.clientSessionId);
  deps.state.markWarming(target.clientSessionId);

  const stream: ActiveHotStream = {
    clientSessionId: target.clientSessionId,
    materializedSessionId: target.materializedSessionId,
    openToken: preservedOpenToken ?? Symbol("hot-session-open"),
    reason: target.reason,
    retryAttempt,
    opening: true,
    retryTimer: null,
  };
  activeStreamsByClientSessionId.set(target.clientSessionId, stream);

  const shouldHydrateBeforeStream = target.reason === "selected";
  logLatency("session.hot_stream.connect", {
    clientSessionId: target.clientSessionId,
    materializedSessionId: target.materializedSessionId,
    reason: target.reason,
    hydrateBeforeStream: shouldHydrateBeforeStream,
    retryAttempt,
  });

  void deps.ensureSessionStreamConnected(target.clientSessionId, {
    awaitOpen: true,
    openTimeoutMs: 2_500,
    resumeIfActive: true,
    allowColdIdleNoStream: true,
    hydrateBeforeStream: shouldHydrateBeforeStream,
    skipInitialRefresh: true,
    refreshOnStartupReady: true,
    reconnectOwner: "external",
    onReconnectNeeded: () => {
      if (!isOpenAttemptCurrent(target, stream.openToken, deps)) {
        return;
      }
      const current = activeStreamsByClientSessionId.get(target.clientSessionId);
      scheduleRetry(target, deps, current?.retryAttempt ?? retryAttempt, stream.openToken);
    },
    isCurrent: () =>
      isOpenAttemptCurrent(target, stream.openToken, deps),
  }).then(() => {
    if (!isOpenAttemptCurrent(target, stream.openToken, deps)) {
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
    if (!isOpenAttemptCurrent(target, stream.openToken, deps)) {
      return;
    }
    const record = deps.state.getSessionRecord(target.clientSessionId);
    deps.state.markStale(target.clientSessionId, {
      lastAppliedSeq: record?.lastSeq ?? 0,
      lastObservedSeq: record?.lastSeq ?? 0,
      gapAfterSeq: null,
      lastErrorAt: new Date().toISOString(),
    });
    scheduleRetry(target, deps, retryAttempt, stream.openToken);
  });
}

function scheduleRetry(
  target: HotSessionTarget & { materializedSessionId: string },
  deps: HotSessionIngestManagerDeps,
  retryAttempt: number,
  openToken: symbol,
): void {
  if (!isOpenAttemptCurrent(target, openToken, deps)) {
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
    if (current?.openToken === openToken && current.retryTimer) {
      current.retryTimer = null;
    }
    if (!isOpenAttemptCurrent(target, openToken, deps)) {
      return;
    }
    connectHotTarget(target, deps, retryAttempt + 1);
  }, delayMs);
}

function isOpenAttemptCurrent(
  target: HotSessionTarget & { materializedSessionId: string },
  openToken: symbol,
  deps: HotSessionIngestManagerDeps,
): boolean {
  const current = activeStreamsByClientSessionId.get(target.clientSessionId);
  return current?.openToken === openToken
    && current.materializedSessionId === target.materializedSessionId
    && deps.state.isTargetCurrent(target.clientSessionId, target.materializedSessionId);
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
