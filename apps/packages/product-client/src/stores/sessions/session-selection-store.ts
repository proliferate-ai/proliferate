import { create } from "zustand";
import type { HotPaintGate } from "#product/lib/domain/sessions/hot-paint-gate";
import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  buildPendingWorkspaceUiKey,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import type { WorkspaceArrivalEvent } from "#product/lib/domain/workspaces/creation/arrival";
import type {
  WorkspaceSessionRecovery,
} from "#product/lib/domain/workspaces/selection/session-recovery";

interface ActivateWorkspaceOptions {
  logicalWorkspaceId: string | null;
  workspaceId: string;
  initialActiveSessionId?: string | null;
  clearPending?: boolean;
  hotPaintGate?: HotPaintGate | null;
}

interface ActivateSessionOptions {
  sessionId: string | null;
  hotPaintGate?: HotPaintGate | null;
}

interface EnterPendingWorkspaceShellOptions {
  initialActiveSessionId?: string | null;
}

interface SessionSelectionState {
  _hydrated: boolean;
  pendingWorkspaceEntry: PendingWorkspaceEntry | null;
  selectedLogicalWorkspaceId: string | null;
  selectedWorkspaceId: string | null;
  workspaceSelectionNonce: number;
  workspaceArrivalEvent: WorkspaceArrivalEvent | null;
  workspaceSessionRecovery: WorkspaceSessionRecovery | null;
  activeSessionId: string | null;
  activeSessionVersion: number;
  sessionActivationIntentEpochByWorkspace: Record<string, number>;
  hotPaintGate: HotPaintGate | null;
  setSelectedLogicalWorkspaceId: (logicalWorkspaceId: string | null) => void;
  enterPendingWorkspaceShell: (
    entry: PendingWorkspaceEntry,
    options?: EnterPendingWorkspaceShellOptions,
  ) => void;
  setPendingWorkspaceEntry: (entry: PendingWorkspaceEntry | null) => void;
  setWorkspaceArrivalEvent: (event: WorkspaceArrivalEvent | null) => void;
  setWorkspaceSessionRecovery: (recovery: WorkspaceSessionRecovery | null) => void;
  activateWorkspace: (options: ActivateWorkspaceOptions) => void;
  activateHotWorkspace: (options: ActivateWorkspaceOptions) => void;
  deselectWorkspacePreservingSessions: () => void;
  clearSelection: () => void;
  setActiveSessionId: (sessionId: string | null) => void;
  activateHotSession: (options: ActivateSessionOptions) => void;
  bumpSessionActivationIntentEpoch: (workspaceId: string) => number;
  clearHotPaintGate: (nonce: number) => void;
  hydrateSelectedLogicalWorkspaceSelection: (selectedLogicalWorkspaceId: string | null) => void;
}

export const useSessionSelectionStore = create<SessionSelectionState>((set, get) => ({
  _hydrated: false,
  pendingWorkspaceEntry: null,
  selectedLogicalWorkspaceId: null,
  selectedWorkspaceId: null,
  workspaceSelectionNonce: 0,
  workspaceArrivalEvent: null,
  workspaceSessionRecovery: null,
  activeSessionId: null,
  activeSessionVersion: 0,
  sessionActivationIntentEpochByWorkspace: {},
  hotPaintGate: null,

  setSelectedLogicalWorkspaceId: (selectedLogicalWorkspaceId) => {
    set({ selectedLogicalWorkspaceId });
  },

  enterPendingWorkspaceShell: (pendingWorkspaceEntry, options) => set((state) => {
    const activeSessionId = options?.initialActiveSessionId ?? null;
    return {
      pendingWorkspaceEntry,
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(pendingWorkspaceEntry),
      selectedWorkspaceId: null,
      workspaceSelectionNonce: state.workspaceSelectionNonce + 1,
      workspaceArrivalEvent: null,
      workspaceSessionRecovery: null,
      activeSessionId,
      activeSessionVersion: bumpVersionIfChanged(
        state.activeSessionVersion,
        state.activeSessionId,
        activeSessionId,
      ),
      hotPaintGate: null,
    };
  }),

  setPendingWorkspaceEntry: (pendingWorkspaceEntry) => {
    set({ pendingWorkspaceEntry });
  },

  setWorkspaceArrivalEvent: (workspaceArrivalEvent) => {
    set({ workspaceArrivalEvent });
  },

  setWorkspaceSessionRecovery: (workspaceSessionRecovery) => {
    set({ workspaceSessionRecovery });
  },

  activateWorkspace: (options) => {
    set((state) => ({
      pendingWorkspaceEntry: options.clearPending === false
        ? state.pendingWorkspaceEntry
        : null,
      selectedLogicalWorkspaceId: options.logicalWorkspaceId,
      selectedWorkspaceId: options.workspaceId,
      workspaceSelectionNonce: state.workspaceSelectionNonce + 1,
      workspaceArrivalEvent: state.workspaceArrivalEvent?.workspaceId === options.workspaceId
        ? state.workspaceArrivalEvent
        : null,
      workspaceSessionRecovery: null,
      activeSessionId: options.initialActiveSessionId ?? null,
      activeSessionVersion: bumpVersionIfChanged(
        state.activeSessionVersion,
        state.activeSessionId,
        options.initialActiveSessionId ?? null,
      ),
      hotPaintGate: options.hotPaintGate ?? state.hotPaintGate,
    }));
  },

  activateHotWorkspace: (options) => {
    set((state) => ({
      pendingWorkspaceEntry: options.clearPending === false
        ? state.pendingWorkspaceEntry
        : null,
      selectedLogicalWorkspaceId: options.logicalWorkspaceId,
      selectedWorkspaceId: options.workspaceId,
      workspaceSelectionNonce: state.workspaceSelectionNonce + 1,
      workspaceArrivalEvent: state.workspaceArrivalEvent?.workspaceId === options.workspaceId
        ? state.workspaceArrivalEvent
        : null,
      workspaceSessionRecovery: null,
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
    }));
  },

  deselectWorkspacePreservingSessions: () => set((state) => {
    return {
      pendingWorkspaceEntry: null,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
      workspaceSelectionNonce: state.workspaceSelectionNonce + 1,
      workspaceArrivalEvent: null,
      workspaceSessionRecovery: null,
      activeSessionId: null,
      activeSessionVersion: bumpVersionIfChanged(
        state.activeSessionVersion,
        state.activeSessionId,
        null,
      ),
      hotPaintGate: null,
    };
  }),

  clearSelection: () => set((state) => {
    return {
      pendingWorkspaceEntry: null,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
      workspaceSelectionNonce: state.workspaceSelectionNonce + 1,
      workspaceArrivalEvent: null,
      workspaceSessionRecovery: null,
      activeSessionId: null,
      activeSessionVersion: bumpVersionIfChanged(
        state.activeSessionVersion,
        state.activeSessionId,
        null,
      ),
      sessionActivationIntentEpochByWorkspace: {},
      hotPaintGate: null,
    };
  }),

  setActiveSessionId: (activeSessionId) => set((state) => {
    return {
      activeSessionId,
      workspaceSessionRecovery:
        activeSessionId
        && activeSessionId !== state.workspaceSessionRecovery?.sessionId
          ? null
          : state.workspaceSessionRecovery,
      activeSessionVersion: bumpVersionIfChanged(
        state.activeSessionVersion,
        state.activeSessionId,
        activeSessionId,
      ),
    };
  }),

  activateHotSession: (options) => set((state) => {
    return {
      activeSessionId: options.sessionId,
      workspaceSessionRecovery:
        options.sessionId
        && options.sessionId !== state.workspaceSessionRecovery?.sessionId
          ? null
          : state.workspaceSessionRecovery,
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

  clearHotPaintGate: (nonce) => set((state) => {
    if (state.hotPaintGate?.nonce !== nonce) {
      return state;
    }
    return { hotPaintGate: null };
  }),

  hydrateSelectedLogicalWorkspaceSelection: (selectedLogicalWorkspaceId) => {
    set({
      _hydrated: true,
      selectedLogicalWorkspaceId,
    });
  },
}));

function bumpVersionIfChanged(
  version: number,
  previousSessionId: string | null,
  nextSessionId: string | null,
): number {
  return previousSessionId === nextSessionId ? version : version + 1;
}
