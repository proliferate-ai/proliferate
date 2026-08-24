import { create } from "zustand";
import type { HotSessionTarget } from "#product/lib/domain/sessions/hot-session-policy";

export type SessionIngestFreshness = "current" | "warming" | "stale" | "cold";

/**
 * Freshness contract: `gapAfterSeq` records the applied watermark at the
 * moment a stream gap was detected — events after it were missed. Only a
 * repair that advances `lastAppliedSeq` past the recorded gap may clear it:
 * an authoritative history refill (`applyHistoryHydration`) or a stream batch
 * that reduced past it (`applyStreamProgress`). Writes that repaired nothing
 * (duplicate-only flushes, reconnects, error marks) must preserve it, or the
 * reopen flow skips the history refill that repairs the hole. A session is
 * `current` only while no gap is recorded, and the `lastAppliedSeq` /
 * `lastObservedSeq` watermarks never move backwards.
 */
export interface SessionIngestFreshnessState {
  freshness: SessionIngestFreshness;
  lastAppliedSeq: number;
  lastObservedSeq: number;
  gapAfterSeq: number | null;
  lastErrorAt: string | null;
}

interface SessionIngestStoreState {
  targetsByClientSessionId: Record<string, HotSessionTarget>;
  freshnessByClientSessionId: Record<string, SessionIngestFreshnessState>;
  setHotTargets: (targets: readonly HotSessionTarget[]) => void;
  markWarming: (clientSessionId: string) => void;
  markCurrentIfContiguous: (clientSessionId: string, lastAppliedSeq: number) => void;
  markStale: (
    clientSessionId: string,
    patch?: Partial<Pick<
      SessionIngestFreshnessState,
      "lastAppliedSeq" | "lastObservedSeq" | "gapAfterSeq" | "lastErrorAt"
    >>,
  ) => void;
  markCold: (clientSessionId: string) => void;
  applyHistoryHydration: (clientSessionId: string, lastAppliedSeq: number) => void;
  applyStreamProgress: (
    clientSessionId: string,
    progress: {
      lastAppliedSeq: number;
      lastObservedSeq: number;
      gapAfterSeq: number | null;
    },
  ) => void;
  clear: () => void;
}

const COLD_FRESHNESS: SessionIngestFreshnessState = {
  freshness: "cold",
  lastAppliedSeq: 0,
  lastObservedSeq: 0,
  gapAfterSeq: null,
  lastErrorAt: null,
};

export const useSessionIngestStore = create<SessionIngestStoreState>((set) => ({
  targetsByClientSessionId: {},
  freshnessByClientSessionId: {},

  setHotTargets: (targets) => {
    set((state) => {
      const targetsByClientSessionId = Object.fromEntries(
        targets.map((target) => [target.clientSessionId, target]),
      );
      if (sameTargets(state.targetsByClientSessionId, targetsByClientSessionId)) {
        return state;
      }

      const freshnessByClientSessionId = { ...state.freshnessByClientSessionId };
      for (const [sessionId, freshness] of Object.entries(freshnessByClientSessionId)) {
        if (!targetsByClientSessionId[sessionId] && freshness.freshness !== "cold") {
          freshnessByClientSessionId[sessionId] = {
            ...freshness,
            freshness: "cold",
          };
        }
      }
      for (const target of targets) {
        const existing = freshnessByClientSessionId[target.clientSessionId] ?? COLD_FRESHNESS;
        if (target.streamable) {
          if (existing.freshness === "cold") {
            freshnessByClientSessionId[target.clientSessionId] = {
              ...existing,
              freshness: "warming",
              lastErrorAt: null,
            };
          }
        } else {
          freshnessByClientSessionId[target.clientSessionId] = {
            ...existing,
            freshness: "warming",
            lastErrorAt: null,
          };
        }
      }

      return {
        targetsByClientSessionId,
        freshnessByClientSessionId,
      };
    });
  },

  markWarming: (clientSessionId) => set((state) => ({
    freshnessByClientSessionId: {
      ...state.freshnessByClientSessionId,
      [clientSessionId]: {
        ...(state.freshnessByClientSessionId[clientSessionId] ?? COLD_FRESHNESS),
        freshness: "warming",
        lastErrorAt: null,
      },
    },
  })),

  markCurrentIfContiguous: (clientSessionId, lastAppliedSeq) => set((state) => {
    const existing = state.freshnessByClientSessionId[clientSessionId] ?? COLD_FRESHNESS;
    if (existing.gapAfterSeq !== null) {
      return state;
    }
    return {
      freshnessByClientSessionId: {
        ...state.freshnessByClientSessionId,
        [clientSessionId]: {
          ...existing,
          freshness: "current",
          lastAppliedSeq,
          lastObservedSeq: Math.max(existing.lastObservedSeq, lastAppliedSeq),
          lastErrorAt: null,
        },
      },
    };
  }),

  markStale: (clientSessionId, patch) => set((state) => {
    const existing = state.freshnessByClientSessionId[clientSessionId] ?? COLD_FRESHNESS;
    return {
      freshnessByClientSessionId: {
        ...state.freshnessByClientSessionId,
        [clientSessionId]: {
          ...existing,
          ...patch,
          lastAppliedSeq: Math.max(existing.lastAppliedSeq, patch?.lastAppliedSeq ?? 0),
          lastObservedSeq: Math.max(existing.lastObservedSeq, patch?.lastObservedSeq ?? 0),
          freshness: "stale",
          lastErrorAt: patch?.lastErrorAt ?? existing.lastErrorAt ?? new Date().toISOString(),
        },
      },
    };
  }),

  markCold: (clientSessionId) => set((state) => {
    const existing = state.freshnessByClientSessionId[clientSessionId] ?? COLD_FRESHNESS;
    return {
      freshnessByClientSessionId: {
        ...state.freshnessByClientSessionId,
        [clientSessionId]: {
          ...existing,
          freshness: "cold",
        },
      },
    };
  }),

  // History replay is authoritative and contiguous, so a refill that advances
  // the applied watermark past a recorded gap has repaired that hole; a refill
  // that does not reach past the gap must leave it recorded.
  applyHistoryHydration: (clientSessionId, lastAppliedSeq) => set((state) => {
    const existing = state.freshnessByClientSessionId[clientSessionId] ?? COLD_FRESHNESS;
    const gapAfterSeq = existing.gapAfterSeq !== null && lastAppliedSeq > existing.gapAfterSeq
      ? null
      : existing.gapAfterSeq;
    const freshness: SessionIngestFreshness = gapAfterSeq === null ? "current" : "stale";
    return {
      freshnessByClientSessionId: {
        ...state.freshnessByClientSessionId,
        [clientSessionId]: {
          ...existing,
          freshness,
          lastAppliedSeq: Math.max(existing.lastAppliedSeq, lastAppliedSeq),
          lastObservedSeq: Math.max(existing.lastObservedSeq, lastAppliedSeq),
          gapAfterSeq,
          lastErrorAt: freshness === "current" ? null : existing.lastErrorAt,
        },
      },
    };
  }),

  applyStreamProgress: (clientSessionId, progress) => set((state) => {
    const existing = state.freshnessByClientSessionId[clientSessionId] ?? COLD_FRESHNESS;
    const freshness: SessionIngestFreshness = progress.gapAfterSeq === null
      ? "current"
      : "stale";
    return {
      freshnessByClientSessionId: {
        ...state.freshnessByClientSessionId,
        [clientSessionId]: {
          ...existing,
          freshness,
          lastAppliedSeq: progress.lastAppliedSeq,
          lastObservedSeq: Math.max(existing.lastObservedSeq, progress.lastObservedSeq),
          gapAfterSeq: progress.gapAfterSeq,
          lastErrorAt: freshness === "stale"
            ? existing.lastErrorAt ?? new Date().toISOString()
            : null,
        },
      },
    };
  }),

  clear: () => set({
    targetsByClientSessionId: {},
    freshnessByClientSessionId: {},
  }),
}));

export function isHotSessionTargetCurrent(
  clientSessionId: string,
  materializedSessionId: string | null,
): boolean {
  const state = useSessionIngestStore.getState();
  const target = state.targetsByClientSessionId[clientSessionId];
  return !!target
    && target.materializedSessionId === materializedSessionId
    && target.streamable;
}

function sameTargets(
  a: Record<string, HotSessionTarget>,
  b: Record<string, HotSessionTarget>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    const left = a[key];
    const right = b[key];
    if (
      !right
      || left.clientSessionId !== right.clientSessionId
      || left.materializedSessionId !== right.materializedSessionId
      || left.workspaceId !== right.workspaceId
      || left.priority !== right.priority
      || left.reason !== right.reason
      || left.streamable !== right.streamable
    ) {
      return false;
    }
  }
  return true;
}
