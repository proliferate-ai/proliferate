import type {
  PendingPromptEntry,
  SessionActionCapabilities,
  SessionEventEnvelope,
  SessionExecutionSummary,
  SessionLiveConfigSnapshot,
  SessionMcpBindingSummary,
  SessionStatus,
  SessionStreamHandle,
  TranscriptState,
} from "@anyharness/sdk";
import { create } from "zustand";
import type { WorkspaceArrivalEvent } from "@/lib/domain/workspaces/arrival";
import type { PendingSessionConfigChanges } from "@/lib/domain/sessions/pending-config";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/pending-entry";
import { DEFAULT_RUNTIME_URL } from "@/config/runtime";
import {
  isDebugMeasurementEnabled,
  recordMeasurementDiagnostic,
  type MeasurementOperationId,
} from "@/lib/infra/debug-measurement";

type ConnectionState = "connecting" | "healthy" | "failed";

export type SessionStreamConnectionState =
  | "disconnected"
  | "connecting"
  | "open"
  | "ended";

export type SessionRelationship =
  | { kind: "root" }
  | { kind: "pending" }
  | SessionChildRelationship;

export type SessionChildRelationship =
  | {
    kind: "subagent_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  }
  | {
    kind: "cowork_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  }
  | {
    kind: "review_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  }
  | {
    kind: "linked_child";
    parentSessionId: string | null;
    sessionLinkId?: string | null;
    relation?: string | null;
    workspaceId?: string | null;
  };

export interface HotPaintGate {
  workspaceId: string;
  sessionId: string;
  nonce: number;
  operationId: MeasurementOperationId | null;
  kind: "workspace_hot_reopen" | "session_hot_switch";
}

export interface SessionSlot {
  sessionId: string;
  workspaceId: string | null;
  agentKind: string;
  modelId: string | null;
  modeId: string | null;
  title: string | null;
  actionCapabilities: SessionActionCapabilities;
  liveConfig: SessionLiveConfigSnapshot | null;
  executionSummary: SessionExecutionSummary | null;
  mcpBindingSummaries: SessionMcpBindingSummary[] | null;
  events: SessionEventEnvelope[];
  transcript: TranscriptState;
  pendingConfigChanges: PendingSessionConfigChanges;
  optimisticPrompt: PendingPromptEntry | null;
  status: SessionStatus | null;
  lastPromptAt: string | null;
  sseHandle: SessionStreamHandle | null;
  streamConnectionState: SessionStreamConnectionState;
  transcriptHydrated: boolean;
  sessionRelationship: SessionRelationship;
}

interface HarnessState {
  runtimeUrl: string;
  connectionState: ConnectionState;

  error: string | null;

  enterPendingWorkspaceShell: (entry: PendingWorkspaceEntry) => void;
  setPendingWorkspaceEntry: (entry: PendingWorkspaceEntry | null) => void;
  setWorkspaceArrivalEvent: (event: WorkspaceArrivalEvent | null) => void;
  setSelectedWorkspace: (
    id: string,
    opts?: { initialActiveSessionId?: string | null; clearPending?: boolean },
  ) => void;
  deselectWorkspacePreservingSlots: () => void;
  removeWorkspaceSlots: (workspaceId: string) => void;
  clearSelection: () => void;
  putSessionSlot: (sessionId: string, slot: SessionSlot) => void;
  patchSessionSlot: (sessionId: string, patch: Partial<SessionSlot>) => void;
  removeSessionSlot: (sessionId: string) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  bumpSessionActivationIntentEpoch: (workspaceId: string) => number;
  setHotPaintGate: (gate: HotPaintGate | null) => void;
  clearHotPaintGate: (nonce: number) => void;

  pendingWorkspaceEntry: PendingWorkspaceEntry | null;
  selectedWorkspaceId: string | null;
  workspaceSelectionNonce: number;
  workspaceArrivalEvent: WorkspaceArrivalEvent | null;

  activeSessionId: string | null;
  activeSessionVersion: number;
  sessionActivationIntentEpochByWorkspace: Record<string, number>;
  sessionSlots: Record<string, SessionSlot>;
  sessionRelationshipHints: Record<string, SessionChildRelationship>;
  hotPaintGate: HotPaintGate | null;

  recordSessionRelationshipHint: (
    sessionId: string,
    relationship: SessionChildRelationship,
  ) => void;
  setSessionRelationship: (
    sessionId: string,
    relationship: SessionRelationship,
  ) => void;
}

export const useHarnessStore = create<HarnessState>((set, get) => ({
  runtimeUrl: DEFAULT_RUNTIME_URL,
  connectionState: "connecting",

  error: null,

  enterPendingWorkspaceShell: (pendingWorkspaceEntry) => set(s => ({
    pendingWorkspaceEntry,
    selectedWorkspaceId: null,
    workspaceSelectionNonce: s.workspaceSelectionNonce + 1,
    workspaceArrivalEvent: null,
    activeSessionId: null,
    activeSessionVersion: bumpVersionIfChanged(s.activeSessionVersion, s.activeSessionId, null),
  })),

  setPendingWorkspaceEntry: (pendingWorkspaceEntry) => set({ pendingWorkspaceEntry }),

  setWorkspaceArrivalEvent: (workspaceArrivalEvent) => set({ workspaceArrivalEvent }),

  setSelectedWorkspace: (id, opts) => set(s => ({
    pendingWorkspaceEntry: opts?.clearPending === false
      ? s.pendingWorkspaceEntry
      : null,
    selectedWorkspaceId: id,
    workspaceSelectionNonce: s.workspaceSelectionNonce + 1,
    // Preserve arrival event when selecting the workspace it belongs to
    // (e.g. lightweight worktree creation sets arrival then selects).
    // Clear when switching to a different workspace.
    workspaceArrivalEvent: s.workspaceArrivalEvent?.workspaceId === id
      ? s.workspaceArrivalEvent
      : null,
    activeSessionId: opts?.initialActiveSessionId ?? null,
    activeSessionVersion: bumpVersionIfChanged(
      s.activeSessionVersion,
      s.activeSessionId,
      opts?.initialActiveSessionId ?? null,
    ),
  })),

  deselectWorkspacePreservingSlots: () => set(s => ({
    pendingWorkspaceEntry: null,
    selectedWorkspaceId: null,
    workspaceSelectionNonce: s.workspaceSelectionNonce + 1,
    workspaceArrivalEvent: null,
    activeSessionId: null,
    activeSessionVersion: bumpVersionIfChanged(s.activeSessionVersion, s.activeSessionId, null),
    hotPaintGate: null,
  })),

  removeWorkspaceSlots: (workspaceId) => set((s) => {
    const removedSessionIds = new Set<string>();
    const sessionSlots = Object.fromEntries(
      Object.entries(s.sessionSlots).filter(([sessionId, slot]) => {
        const keep = slot.workspaceId !== workspaceId;
        if (!keep) {
          removedSessionIds.add(sessionId);
        }
        return keep;
      }),
    );
    const sessionRelationshipHints = Object.fromEntries(
      Object.entries(s.sessionRelationshipHints).filter(([sessionId, hint]) =>
        !removedSessionIds.has(sessionId) && hint.workspaceId !== workspaceId
      ),
    );
    const nextActiveSessionId = s.activeSessionId && s.sessionSlots[s.activeSessionId]?.workspaceId !== workspaceId
      ? s.activeSessionId
      : null;
    return {
      sessionSlots,
      sessionRelationshipHints,
      activeSessionId: nextActiveSessionId,
      activeSessionVersion: bumpVersionIfChanged(
        s.activeSessionVersion,
        s.activeSessionId,
        nextActiveSessionId,
      ),
      hotPaintGate: s.hotPaintGate?.workspaceId === workspaceId ? null : s.hotPaintGate,
    };
  }),

  clearSelection: () => set(s => ({
    pendingWorkspaceEntry: null,
    selectedWorkspaceId: null,
    workspaceSelectionNonce: s.workspaceSelectionNonce + 1,
    workspaceArrivalEvent: null,
    activeSessionId: null,
    activeSessionVersion: bumpVersionIfChanged(s.activeSessionVersion, s.activeSessionId, null),
    sessionSlots: {},
    sessionRelationshipHints: {},
    hotPaintGate: null,
  })),

  putSessionSlot: (sessionId, slot) => set((state) => {
    const hint = state.sessionRelationshipHints[sessionId];
    const { [sessionId]: _consumedHint, ...remainingHints } = state.sessionRelationshipHints;
    return {
      sessionSlots: {
        ...state.sessionSlots,
        [sessionId]: hint ? { ...slot, sessionRelationship: hint } : slot,
      },
      sessionRelationshipHints: hint ? remainingHints : state.sessionRelationshipHints,
    };
  }),

  patchSessionSlot: (sessionId, patch) => set((state) => {
    const slot = state.sessionSlots[sessionId];
    if (!slot) {
      return state;
    }

    return {
      sessionSlots: {
        ...state.sessionSlots,
        [sessionId]: { ...slot, ...patch },
      },
    };
  }),

  removeSessionSlot: (sessionId) => set((state) => {
    if (!state.sessionSlots[sessionId]) {
      return state;
    }
    const { [sessionId]: _removed, ...sessionSlots } = state.sessionSlots;
    const { [sessionId]: _removedHint, ...sessionRelationshipHints } =
      state.sessionRelationshipHints;
    const nextActiveSessionId = state.activeSessionId === sessionId ? null : state.activeSessionId;
    return {
      sessionSlots,
      sessionRelationshipHints,
      activeSessionId: nextActiveSessionId,
      activeSessionVersion: bumpVersionIfChanged(
        state.activeSessionVersion,
        state.activeSessionId,
        nextActiveSessionId,
      ),
    };
  }),

  setActiveSessionId: (activeSessionId) => set((state) => ({
    activeSessionId,
    activeSessionVersion: bumpVersionIfChanged(
      state.activeSessionVersion,
      state.activeSessionId,
      activeSessionId,
    ),
  })),

  bumpSessionActivationIntentEpoch: (workspaceId) => {
    const current = get().sessionActivationIntentEpochByWorkspace[workspaceId] ?? 0;
    const next = current + 1;
    set((state) => ({
      sessionActivationIntentEpochByWorkspace: {
        ...state.sessionActivationIntentEpochByWorkspace,
        [workspaceId]: next,
      },
    }));
    return next;
  },

  setHotPaintGate: (hotPaintGate) => set({ hotPaintGate }),

  clearHotPaintGate: (nonce) => set((state) => (
    state.hotPaintGate?.nonce === nonce
      ? { hotPaintGate: null }
      : state
  )),

  recordSessionRelationshipHint: (sessionId, relationship) => set((state) => {
    const slot = state.sessionSlots[sessionId];
    if (slot) {
      const sessionRelationshipHints = removeRecordKey(
        state.sessionRelationshipHints,
        sessionId,
      );
      if (sessionRelationshipEqual(slot.sessionRelationship, relationship)) {
        return sessionRelationshipHints === state.sessionRelationshipHints
          ? state
          : { sessionRelationshipHints };
      }
      return {
        sessionSlots: {
          ...state.sessionSlots,
          [sessionId]: {
            ...slot,
            sessionRelationship: relationship,
          },
        },
        sessionRelationshipHints,
      };
    }

    const existing = state.sessionRelationshipHints[sessionId];
    if (sessionChildRelationshipEqual(existing, relationship)) {
      return state;
    }

    return {
      sessionRelationshipHints: {
        ...state.sessionRelationshipHints,
        [sessionId]: relationship,
      },
    };
  }),

  setSessionRelationship: (sessionId, relationship) => set((state) => {
    const slot = state.sessionSlots[sessionId];
    if (!slot) {
      return state;
    }
    if (sessionRelationshipEqual(slot.sessionRelationship, relationship)) {
      return state;
    }
    return {
      sessionSlots: {
        ...state.sessionSlots,
        [sessionId]: {
          ...slot,
          sessionRelationship: relationship,
        },
      },
    };
  }),

  pendingWorkspaceEntry: null,
  selectedWorkspaceId: null,
  workspaceSelectionNonce: 0,
  workspaceArrivalEvent: null,

  activeSessionId: null,
  activeSessionVersion: 0,
  sessionActivationIntentEpochByWorkspace: {},
  sessionSlots: {},
  sessionRelationshipHints: {},
  hotPaintGate: null,
}));

function bumpVersionIfChanged(
  version: number,
  previousSessionId: string | null,
  nextSessionId: string | null,
): number {
  return previousSessionId === nextSessionId ? version : version + 1;
}

function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record;
  }
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function sessionRelationshipEqual(
  a: SessionRelationship | undefined,
  b: SessionRelationship | undefined,
): boolean {
  if (!a || !b || a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "root" || a.kind === "pending") {
    return true;
  }
  return sessionChildRelationshipEqual(a, b as SessionChildRelationship);
}

function sessionChildRelationshipEqual(
  a: SessionChildRelationship | undefined,
  b: SessionChildRelationship | undefined,
): boolean {
  return !!a
    && !!b
    && a.kind === b.kind
    && a.parentSessionId === b.parentSessionId
    && (a.sessionLinkId ?? null) === (b.sessionLinkId ?? null)
    && (a.relation ?? null) === (b.relation ?? null)
    && (a.workspaceId ?? null) === (b.workspaceId ?? null);
}

const RETAINED_SESSION_SLOT_WARNING_THRESHOLD = 50;
const retainedSessionSlotWarningEnabled = isDebugMeasurementEnabled();
let lastRetainedSlotWarningBucket = 0;

if (isDebugMeasurementEnabled()) {
  let previousHarnessState = useHarnessStore.getState();
  const unsubscribeHarnessStoreDiagnostics = useHarnessStore.subscribe((state) => {
    const changedKeys = getChangedHarnessStateKeys(previousHarnessState, state);
    previousHarnessState = state;
    if (changedKeys.length === 0) {
      return;
    }
    recordMeasurementDiagnostic({
      category: "harness_store.write",
      label: "top_level_keys",
      keys: changedKeys,
      count: changedKeys.length,
      detail: buildHarnessStateWriteDetail(state),
    });
  });

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      unsubscribeHarnessStoreDiagnostics();
    });
  }
}

if (retainedSessionSlotWarningEnabled) {
  const unsubscribeRetainedSlotWarning = useHarnessStore.subscribe((state) => {
    const retainedSlotCount = Object.keys(state.sessionSlots).length;
    const warningBucket = Math.floor(
      retainedSlotCount / RETAINED_SESSION_SLOT_WARNING_THRESHOLD,
    );
    if (warningBucket <= 0 || warningBucket === lastRetainedSlotWarningBucket) {
      return;
    }
    lastRetainedSlotWarningBucket = warningBucket;
    console.warn("[debug-measurement] retained session slot warning", {
      tag: "retained_session_slot_warning",
      retainedSlotCount,
      threshold: RETAINED_SESSION_SLOT_WARNING_THRESHOLD,
    });
  });

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      unsubscribeRetainedSlotWarning();
    });
  }
}

export function isHotPaintGatePendingForWorkspace(
  gate: HotPaintGate | null,
  workspaceId: string | null | undefined,
): boolean {
  return !!workspaceId && gate?.workspaceId === workspaceId;
}

function getChangedHarnessStateKeys(
  previous: HarnessState,
  next: HarnessState,
): string[] {
  // Manual top-level allowlist for debug diagnostics. Keep this in sync when
  // adding harness state that should show up in store-write traces.
  return [
    "runtimeUrl",
    "connectionState",
    "error",
    "pendingWorkspaceEntry",
    "selectedWorkspaceId",
    "workspaceSelectionNonce",
    "workspaceArrivalEvent",
    "activeSessionId",
    "activeSessionVersion",
    "sessionActivationIntentEpochByWorkspace",
    "sessionSlots",
    "sessionRelationshipHints",
    "hotPaintGate",
  ].filter((key) => !Object.is(
    previous[key as keyof HarnessState],
    next[key as keyof HarnessState],
  ));
}

function buildHarnessStateWriteDetail(state: HarnessState): string {
  return [
    `slots=${Object.keys(state.sessionSlots).length}`,
    `workspace=${state.selectedWorkspaceId ?? "none"}`,
    `active=${state.activeSessionId ?? "none"}`,
    `hotGate=${state.hotPaintGate?.kind ?? "none"}`,
  ].join(" ");
}
