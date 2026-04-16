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

type ConnectionState = "connecting" | "healthy" | "failed";

export type SessionStreamConnectionState =
  | "disconnected"
  | "connecting"
  | "open"
  | "ended";

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
  removeWorkspaceSlots: (workspaceId: string) => void;
  clearSelection: () => void;
  putSessionSlot: (sessionId: string, slot: SessionSlot) => void;
  patchSessionSlot: (sessionId: string, patch: Partial<SessionSlot>) => void;
  setActiveSessionId: (sessionId: string | null) => void;

  pendingWorkspaceEntry: PendingWorkspaceEntry | null;
  selectedWorkspaceId: string | null;
  workspaceSelectionNonce: number;
  workspaceArrivalEvent: WorkspaceArrivalEvent | null;

  activeSessionId: string | null;
  sessionSlots: Record<string, SessionSlot>;
}

export const useHarnessStore = create<HarnessState>((set) => ({
  runtimeUrl: DEFAULT_RUNTIME_URL,
  connectionState: "connecting",

  error: null,

  enterPendingWorkspaceShell: (pendingWorkspaceEntry) => set(s => ({
    pendingWorkspaceEntry,
    selectedWorkspaceId: null,
    workspaceSelectionNonce: s.workspaceSelectionNonce + 1,
    workspaceArrivalEvent: null,
    activeSessionId: null,
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
  })),

  removeWorkspaceSlots: (workspaceId) => set(s => ({
    sessionSlots: Object.fromEntries(
      Object.entries(s.sessionSlots).filter(([, slot]) => slot.workspaceId !== workspaceId),
    ),
    activeSessionId: s.activeSessionId && s.sessionSlots[s.activeSessionId]?.workspaceId !== workspaceId
      ? s.activeSessionId
      : null,
  })),

  clearSelection: () => set(s => ({
    pendingWorkspaceEntry: null,
    selectedWorkspaceId: null,
    workspaceSelectionNonce: s.workspaceSelectionNonce + 1,
    workspaceArrivalEvent: null,
    activeSessionId: null,
    sessionSlots: {},
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

  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),

  pendingWorkspaceEntry: null,
  selectedWorkspaceId: null,
  workspaceSelectionNonce: 0,
  workspaceArrivalEvent: null,

  activeSessionId: null,
  sessionSlots: {},
}));
