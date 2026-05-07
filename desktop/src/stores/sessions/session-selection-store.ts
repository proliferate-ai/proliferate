import { create } from "zustand";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";
import {
  buildPendingWorkspaceUiKey,
  isPendingWorkspaceUiKey,
} from "@/lib/domain/workspaces/creation/pending-entry";
import type { WorkspaceArrivalEvent } from "@/lib/domain/workspaces/creation/arrival";
import { readPersistedValue, persistValue } from "@/lib/infra/persistence/preferences-persistence";
import type { HotPaintGate } from "@/stores/sessions/session-types";

const LOGICAL_WORKSPACE_SELECTION_KEY = "selected_logical_workspace_id";

interface ActivateWorkspaceOptions {
  logicalWorkspaceId: string | null;
  workspaceId: string;
  initialActiveSessionId?: string | null;
  clearPending?: boolean;
  hotPaintGate?: HotPaintGate | null;
}

interface ActivateSessionOptions {
  sessionId: string | null;
  workspaceId?: string | null;
  hotPaintGate?: HotPaintGate | null;
}

interface SessionSelectionState {
  hydrated: boolean;
  pendingWorkspaceEntry: PendingWorkspaceEntry | null;
  selectedLogicalWorkspaceId: string | null;
  selectedWorkspaceId: string | null;
  workspaceSelectionNonce: number;
  workspaceArrivalEvent: WorkspaceArrivalEvent | null;
  activeSessionId: string | null;
  activeSessionVersion: number;
  sessionActivationIntentEpochByWorkspace: Record<string, number>;
  hotPaintGate: HotPaintGate | null;
  setSelectedLogicalWorkspaceId: (logicalWorkspaceId: string | null) => void;
  enterPendingWorkspaceShell: (entry: PendingWorkspaceEntry) => void;
  setPendingWorkspaceEntry: (entry: PendingWorkspaceEntry | null) => void;
  setWorkspaceArrivalEvent: (event: WorkspaceArrivalEvent | null) => void;
  activateWorkspace: (options: ActivateWorkspaceOptions) => void;
  activateHotWorkspace: (options: ActivateWorkspaceOptions) => void;
  deselectWorkspacePreservingSessions: () => void;
  clearSelection: () => void;
  setActiveSessionId: (sessionId: string | null) => void;
  activateHotSession: (options: ActivateSessionOptions) => void;
  bumpSessionActivationIntentEpoch: (workspaceId: string) => number;
  setHotPaintGate: (gate: HotPaintGate | null) => void;
  clearHotPaintGate: (nonce: number) => void;
  markHydrated: (selectedLogicalWorkspaceId: string | null) => void;
}

export const useSessionSelectionStore = create<SessionSelectionState>((set, get) => ({
  hydrated: false,
  pendingWorkspaceEntry: null,
  selectedLogicalWorkspaceId: null,
  selectedWorkspaceId: null,
  workspaceSelectionNonce: 0,
  workspaceArrivalEvent: null,
  activeSessionId: null,
  activeSessionVersion: 0,
  sessionActivationIntentEpochByWorkspace: {},
  hotPaintGate: null,

  setSelectedLogicalWorkspaceId: (selectedLogicalWorkspaceId) => set({ selectedLogicalWorkspaceId }),

  enterPendingWorkspaceShell: (pendingWorkspaceEntry) => set((state) => ({
    pendingWorkspaceEntry,
    selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(pendingWorkspaceEntry),
    selectedWorkspaceId: null,
    workspaceSelectionNonce: state.workspaceSelectionNonce + 1,
    workspaceArrivalEvent: null,
    activeSessionId: null,
    activeSessionVersion: bumpVersionIfChanged(
      state.activeSessionVersion,
      state.activeSessionId,
      null,
    ),
    hotPaintGate: null,
  })),

  setPendingWorkspaceEntry: (pendingWorkspaceEntry) => set({ pendingWorkspaceEntry }),

  setWorkspaceArrivalEvent: (workspaceArrivalEvent) => set({ workspaceArrivalEvent }),

  activateWorkspace: (options) => set((state) => ({
    pendingWorkspaceEntry: options.clearPending === false
      ? state.pendingWorkspaceEntry
      : null,
    selectedLogicalWorkspaceId: options.logicalWorkspaceId,
    selectedWorkspaceId: options.workspaceId,
    workspaceSelectionNonce: state.workspaceSelectionNonce + 1,
    workspaceArrivalEvent: state.workspaceArrivalEvent?.workspaceId === options.workspaceId
      ? state.workspaceArrivalEvent
      : null,
    activeSessionId: options.initialActiveSessionId ?? null,
    activeSessionVersion: bumpVersionIfChanged(
      state.activeSessionVersion,
      state.activeSessionId,
      options.initialActiveSessionId ?? null,
    ),
    hotPaintGate: options.hotPaintGate ?? state.hotPaintGate,
  })),

  activateHotWorkspace: (options) => set((state) => ({
    pendingWorkspaceEntry: options.clearPending === false
      ? state.pendingWorkspaceEntry
      : null,
    selectedLogicalWorkspaceId: options.logicalWorkspaceId,
    selectedWorkspaceId: options.workspaceId,
    workspaceSelectionNonce: state.workspaceSelectionNonce + 1,
    workspaceArrivalEvent: state.workspaceArrivalEvent?.workspaceId === options.workspaceId
      ? state.workspaceArrivalEvent
      : null,
    activeSessionId: options.initialActiveSessionId ?? null,
    activeSessionVersion: bumpVersionIfChanged(
      state.activeSessionVersion,
      state.activeSessionId,
      options.initialActiveSessionId ?? null,
    ),
    sessionActivationIntentEpochByWorkspace: options.workspaceId
      ? {
        ...state.sessionActivationIntentEpochByWorkspace,
        [options.workspaceId]: (
          state.sessionActivationIntentEpochByWorkspace[options.workspaceId] ?? 0
        ) + 1,
      }
      : state.sessionActivationIntentEpochByWorkspace,
    hotPaintGate: options.hotPaintGate ?? null,
  })),

  deselectWorkspacePreservingSessions: () => set((state) => ({
    pendingWorkspaceEntry: null,
    selectedWorkspaceId: null,
    workspaceSelectionNonce: state.workspaceSelectionNonce + 1,
    workspaceArrivalEvent: null,
    activeSessionId: null,
    activeSessionVersion: bumpVersionIfChanged(
      state.activeSessionVersion,
      state.activeSessionId,
      null,
    ),
    hotPaintGate: null,
  })),

  clearSelection: () => set((state) => ({
    pendingWorkspaceEntry: null,
    selectedLogicalWorkspaceId: null,
    selectedWorkspaceId: null,
    workspaceSelectionNonce: state.workspaceSelectionNonce + 1,
    workspaceArrivalEvent: null,
    activeSessionId: null,
    activeSessionVersion: bumpVersionIfChanged(
      state.activeSessionVersion,
      state.activeSessionId,
      null,
    ),
    sessionActivationIntentEpochByWorkspace: {},
    hotPaintGate: null,
  })),

  setActiveSessionId: (activeSessionId) => set((state) => ({
    activeSessionId,
    activeSessionVersion: bumpVersionIfChanged(
      state.activeSessionVersion,
      state.activeSessionId,
      activeSessionId,
    ),
  })),

  activateHotSession: (options) => set((state) => {
    return {
      activeSessionId: options.sessionId,
      activeSessionVersion: bumpVersionIfChanged(
        state.activeSessionVersion,
        state.activeSessionId,
        options.sessionId,
      ),
      hotPaintGate: options.hotPaintGate ?? null,
    };
  }),

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

  markHydrated: (selectedLogicalWorkspaceId) => set({
    hydrated: true,
    selectedLogicalWorkspaceId,
  }),
}));

useSessionSelectionStore.subscribe((state, prev) => {
  if (!state.hydrated || state.selectedLogicalWorkspaceId === prev.selectedLogicalWorkspaceId) {
    return;
  }

  if (isPendingWorkspaceUiKey(state.selectedLogicalWorkspaceId)) {
    return;
  }

  void persistValue(LOGICAL_WORKSPACE_SELECTION_KEY, state.selectedLogicalWorkspaceId);
});

export async function bootstrapSessionSelection(): Promise<void> {
  const selectedLogicalWorkspaceId =
    (await readPersistedValue<string | null>(LOGICAL_WORKSPACE_SELECTION_KEY))
    ?? null;
  useSessionSelectionStore.getState().markHydrated(
    isPendingWorkspaceUiKey(selectedLogicalWorkspaceId)
      ? null
      : selectedLogicalWorkspaceId,
  );
}

export function isHotPaintGatePendingForWorkspace(
  gate: HotPaintGate | null,
  workspaceId: string | null | undefined,
): boolean {
  return !!workspaceId && gate?.workspaceId === workspaceId;
}

function bumpVersionIfChanged(
  version: number,
  previousSessionId: string | null,
  nextSessionId: string | null,
): number {
  return previousSessionId === nextSessionId ? version : version + 1;
}
