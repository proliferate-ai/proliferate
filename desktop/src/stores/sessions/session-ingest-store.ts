import { create } from "zustand";
import type { HotSessionTarget } from "@/lib/domain/sessions/hot-session-policy";

export type SessionIngestFreshness = "current" | "warming" | "stale" | "cold";

export interface SessionIngestFreshnessState {
  freshness: SessionIngestFreshness;
  lastAppliedSeq: number;
  lastObservedSeq: number;
  gapAfterSeq: number | null;
  lastErrorAt: string | null;
}

interface SessionIngestStoreState {
  hotSetGeneration: number;
  targetsByClientSessionId: Record<string, HotSessionTarget>;
  freshnessByClientSessionId: Record<string, SessionIngestFreshnessState>;
  setHotTargets: (targets: readonly HotSessionTarget[]) => number;
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

export const useSessionIngestStore = create<SessionIngestStoreState>((set, get) => ({
  hotSetGeneration: 0,
  targetsByClientSessionId: {},
  freshnessByClientSessionId: {},

  setHotTargets: (targets) => {
    let nextGeneration = get().hotSetGeneration;
    set((state) => {
      const targetsByClientSessionId = Object.fromEntries(
        targets.map((target) => [target.clientSessionId, target]),
      );
      if (sameTargets(state.targetsByClientSessionId, targetsByClientSessionId)) {
        return state;
      }

      nextGeneration = state.hotSetGeneration + 1;
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
        hotSetGeneration: nextGeneration,
        targetsByClientSessionId,
        freshnessByClientSessionId,
      };
    });
    return nextGeneration;
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
    hotSetGeneration: 0,
    targetsByClientSessionId: {},
    freshnessByClientSessionId: {},
  }),
}));

export function isHotSessionTargetCurrent(
  clientSessionId: string,
  generation: number,
  materializedSessionId: string | null,
): boolean {
  const state = useSessionIngestStore.getState();
  const target = state.targetsByClientSessionId[clientSessionId];
  return state.hotSetGeneration === generation
    && !!target
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
