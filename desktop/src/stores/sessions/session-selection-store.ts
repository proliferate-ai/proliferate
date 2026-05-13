import { create } from "zustand";
import type { HotPaintGate } from "@/lib/domain/sessions/hot-paint-gate";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";
import {
  buildPendingWorkspaceUiKey,
} from "@/lib/domain/workspaces/creation/pending-entry";
import type { WorkspaceArrivalEvent } from "@/lib/domain/workspaces/creation/arrival";
import { recordDebugStoreTransition } from "@/lib/infra/measurement/debug-action-diagnostic";

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
  activeSessionId: null,
  activeSessionVersion: 0,
  sessionActivationIntentEpochByWorkspace: {},
  hotPaintGate: null,

  setSelectedLogicalWorkspaceId: (selectedLogicalWorkspaceId) => {
    const detail = { selectedLogicalWorkspaceId };
    set((state) => withRecordedSessionSelectionTransition(
      state,
      "setSelectedLogicalWorkspaceId",
      detail,
      { selectedLogicalWorkspaceId },
    ));
  },

  enterPendingWorkspaceShell: (pendingWorkspaceEntry, options) => set((state) => {
    const activeSessionId = options?.initialActiveSessionId ?? null;
    const detail = {
      attemptId: pendingWorkspaceEntry.attemptId,
      requestKind: pendingWorkspaceEntry.request.kind,
      activeSessionId,
      pendingWorkspaceUiKey: buildPendingWorkspaceUiKey(pendingWorkspaceEntry),
    };
    return withRecordedSessionSelectionTransition(
      state,
      "enterPendingWorkspaceShell",
      detail,
      {
      pendingWorkspaceEntry,
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(pendingWorkspaceEntry),
      selectedWorkspaceId: null,
      workspaceSelectionNonce: state.workspaceSelectionNonce + 1,
      workspaceArrivalEvent: null,
      activeSessionId,
      activeSessionVersion: bumpVersionIfChanged(
        state.activeSessionVersion,
        state.activeSessionId,
        activeSessionId,
      ),
      hotPaintGate: null,
      },
    );
  }),

  setPendingWorkspaceEntry: (pendingWorkspaceEntry) => {
    const detail = {
      attemptId: pendingWorkspaceEntry?.attemptId ?? null,
      requestKind: pendingWorkspaceEntry?.request.kind ?? null,
      workspaceId: pendingWorkspaceEntry
        && "workspaceId" in pendingWorkspaceEntry.request
        ? pendingWorkspaceEntry.request.workspaceId
        : null,
    };
    set((state) => withRecordedSessionSelectionTransition(
      state,
      "setPendingWorkspaceEntry",
      detail,
      { pendingWorkspaceEntry },
    ));
  },

  setWorkspaceArrivalEvent: (workspaceArrivalEvent) => {
    const detail = {
      workspaceId: workspaceArrivalEvent?.workspaceId ?? null,
      source: workspaceArrivalEvent?.source ?? null,
    };
    set((state) => withRecordedSessionSelectionTransition(
      state,
      "setWorkspaceArrivalEvent",
      detail,
      { workspaceArrivalEvent },
    ));
  },

  activateWorkspace: (options) => {
    const detail = {
      logicalWorkspaceId: options.logicalWorkspaceId,
      workspaceId: options.workspaceId,
      initialActiveSessionId: options.initialActiveSessionId ?? null,
      clearPending: options.clearPending ?? null,
      hotPaintGate: Boolean(options.hotPaintGate),
    };
    set((state) => withRecordedSessionSelectionTransition(
      state,
      "activateWorkspace",
      detail,
      {
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
      },
    ));
  },

  activateHotWorkspace: (options) => {
    const detail = {
      logicalWorkspaceId: options.logicalWorkspaceId,
      workspaceId: options.workspaceId,
      initialActiveSessionId: options.initialActiveSessionId ?? null,
      clearPending: options.clearPending ?? null,
      hotPaintGate: Boolean(options.hotPaintGate),
    };
    set((state) => withRecordedSessionSelectionTransition(
      state,
      "activateHotWorkspace",
      detail,
      {
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
      },
    ));
  },

  deselectWorkspacePreservingSessions: () => set((state) => {
    const detail = {
      selectedWorkspaceId: state.selectedWorkspaceId,
      selectedLogicalWorkspaceId: state.selectedLogicalWorkspaceId,
      activeSessionId: state.activeSessionId,
    };
    return withRecordedSessionSelectionTransition(
      state,
      "deselectWorkspacePreservingSessions",
      detail,
      {
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
      },
    );
  }),

  clearSelection: () => set((state) => {
    const detail = {
      selectedWorkspaceId: state.selectedWorkspaceId,
      selectedLogicalWorkspaceId: state.selectedLogicalWorkspaceId,
      activeSessionId: state.activeSessionId,
    };
    return withRecordedSessionSelectionTransition(
      state,
      "clearSelection",
      detail,
      {
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
      },
    );
  }),

  setActiveSessionId: (activeSessionId) => set((state) => {
    const detail = {
      previousSessionId: state.activeSessionId,
      activeSessionId,
    };
    return withRecordedSessionSelectionTransition(
      state,
      "setActiveSessionId",
      detail,
      {
      activeSessionId,
      activeSessionVersion: bumpVersionIfChanged(
        state.activeSessionVersion,
        state.activeSessionId,
        activeSessionId,
      ),
      },
    );
  }),

  activateHotSession: (options) => set((state) => {
    const detail = {
      previousSessionId: state.activeSessionId,
      sessionId: options.sessionId,
      hotPaintGate: Boolean(options.hotPaintGate),
    };
    return withRecordedSessionSelectionTransition(
      state,
      "activateHotSession",
      detail,
      {
      activeSessionId: options.sessionId,
      activeSessionVersion: bumpVersionIfChanged(
        state.activeSessionVersion,
        state.activeSessionId,
        options.sessionId,
      ),
      hotPaintGate: options.hotPaintGate ?? null,
      },
    );
  }),

  bumpSessionActivationIntentEpoch: (workspaceId) => {
    const current = get().sessionActivationIntentEpochByWorkspace[workspaceId] ?? 0;
    const next = current + 1;
    set((state) => withRecordedSessionSelectionTransition(
      state,
      "bumpSessionActivationIntentEpoch",
      { workspaceId, previousEpoch: current, nextEpoch: next },
      {
      sessionActivationIntentEpochByWorkspace: {
        ...state.sessionActivationIntentEpochByWorkspace,
        [workspaceId]: next,
      },
      },
    ));
    return next;
  },

  clearHotPaintGate: (nonce) => set((state) => {
    if (state.hotPaintGate?.nonce !== nonce) {
      return state;
    }
    return withRecordedSessionSelectionTransition(
      state,
      "clearHotPaintGate",
      { nonce },
      { hotPaintGate: null },
    );
  }),

  hydrateSelectedLogicalWorkspaceSelection: (selectedLogicalWorkspaceId) => {
    const detail = { selectedLogicalWorkspaceId };
    set((state) => withRecordedSessionSelectionTransition(
      state,
      "hydrateSelectedLogicalWorkspaceSelection",
      detail,
      {
      _hydrated: true,
      selectedLogicalWorkspaceId,
      },
    ));
  },
}));

function bumpVersionIfChanged(
  version: number,
  previousSessionId: string | null,
  nextSessionId: string | null,
): number {
  return previousSessionId === nextSessionId ? version : version + 1;
}

function withRecordedSessionSelectionTransition(
  current: SessionSelectionState,
  label: string,
  detail?: Record<string, unknown>,
  next?: Partial<SessionSelectionState> | SessionSelectionState,
): Partial<SessionSelectionState> | SessionSelectionState {
  const resolvedNext = next ?? current;
  recordDebugStoreTransition({
    category: "session-selection-store",
    label,
    before: current,
    after: resolvedNext,
    detail,
  });
  return resolvedNext;
}
