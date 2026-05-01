import type {
  PendingPromptEntry,
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
  type MeasurementOperationId,
} from "@/lib/infra/debug-measurement";

type ConnectionState = "connecting" | "healthy" | "failed";

export type SessionStreamConnectionState =
  | "disconnected"
  | "connecting"
  | "open"
  | "ended";

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
  hotPaintGate: HotPaintGate | null;
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
    const nextActiveSessionId = s.activeSessionId && s.sessionSlots[s.activeSessionId]?.workspaceId !== workspaceId
      ? s.activeSessionId
      : null;
    return {
      sessionSlots: Object.fromEntries(
        Object.entries(s.sessionSlots).filter(([, slot]) => slot.workspaceId !== workspaceId),
      ),
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
    hotPaintGate: null,
  })),

  putSessionSlot: (sessionId, slot) => set((state) => ({
    sessionSlots: {
      ...state.sessionSlots,
      [sessionId]: slot,
    },
  })),

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
    const nextActiveSessionId = state.activeSessionId === sessionId ? null : state.activeSessionId;
    return {
      sessionSlots,
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

  pendingWorkspaceEntry: null,
  selectedWorkspaceId: null,
  workspaceSelectionNonce: 0,
  workspaceArrivalEvent: null,

  activeSessionId: null,
  activeSessionVersion: 0,
  sessionActivationIntentEpochByWorkspace: {},
  sessionSlots: {},
  hotPaintGate: null,
}));

function bumpVersionIfChanged(
  version: number,
  previousSessionId: string | null,
  nextSessionId: string | null,
): number {
  return previousSessionId === nextSessionId ? version : version + 1;
}

const RETAINED_SESSION_SLOT_WARNING_THRESHOLD = 50;
const retainedSessionSlotWarningEnabled = isDebugMeasurementEnabled();
let lastRetainedSlotWarningBucket = 0;

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
