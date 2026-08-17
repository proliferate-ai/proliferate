import type { SetStateAction } from "react";
import {
  clampRightPanelWidth,
  DEFAULT_RIGHT_PANEL_DURABLE_STATE,
  DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE,
  normalizeRightPanelDurableState,
  type RightPanelWorkspaceState,
} from "#product/lib/domain/workspaces/shell/right-panel-model";
import { reconcileRightPanelWorkspaceState } from "#product/lib/domain/workspaces/shell/right-panel-state-normalization";
import { resolveStateValue } from "#product/stores/preferences/workspace-ui-state-value";
import type { WorkspaceUiSet, WorkspaceUiState } from "#product/stores/preferences/workspace-ui-store-types";

type WorkspaceUiRightPanelActions = Pick<
  WorkspaceUiState,
  | "setRightPanelForWorkspace"
  | "setRightPanelDurableForWorkspace"
  | "setRightPanelMaterializedForWorkspace"
  | "setRightPanelWidthForWorkspace"
  | "setRightPanelOpenForWorkspace"
  | "setPendingBackgroundSubagentSelectionForWorkspace"
  | "clearPendingBackgroundSubagentSelectionForWorkspace"
  | "markBackgroundWorkViewedForSession"
  | "recordBackgroundWorkFinishedSubagentForSession"
>;

function rightPanelStateUpdate(
  state: WorkspaceUiState,
  workspaceId: string,
  value: SetStateAction<RightPanelWorkspaceState>,
): Pick<WorkspaceUiState, "rightPanelMaterializedByWorkspace"> {
  const currentMaterialized = state.rightPanelMaterializedByWorkspace[workspaceId]
    ?? DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE;
  const nextMaterialized = reconcileRightPanelWorkspaceState(
    resolveStateValue(value, currentMaterialized),
    { isCloudWorkspaceSelected: true },
  );

  return {
    rightPanelMaterializedByWorkspace: {
      ...state.rightPanelMaterializedByWorkspace,
      [workspaceId]: nextMaterialized,
    },
  };
}

export function createWorkspaceUiRightPanelActions(
  set: WorkspaceUiSet,
): WorkspaceUiRightPanelActions {
  return {
    setRightPanelForWorkspace: (workspaceId, value) => {
      set((state) => rightPanelStateUpdate(state, workspaceId, value));
    },

    setRightPanelDurableForWorkspace: (workspaceId, value) => {
      set((state) => ({
        rightPanelDurableByWorkspace: {
          ...state.rightPanelDurableByWorkspace,
          [workspaceId]: normalizeRightPanelDurableState(
            resolveStateValue(
              value,
              state.rightPanelDurableByWorkspace[workspaceId] ?? DEFAULT_RIGHT_PANEL_DURABLE_STATE,
            ),
          ),
        },
      }));
    },

    setRightPanelMaterializedForWorkspace: (workspaceId, value) => {
      set((state) => ({
        rightPanelMaterializedByWorkspace: {
          ...state.rightPanelMaterializedByWorkspace,
          [workspaceId]: reconcileRightPanelWorkspaceState(
            resolveStateValue(
              value,
              state.rightPanelMaterializedByWorkspace[workspaceId]
                ?? DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE,
            ),
            { isCloudWorkspaceSelected: true },
          ),
        },
      }));
    },

    setRightPanelWidthForWorkspace: (workspaceId, value) => {
      set((state) => {
        const current = state.rightPanelDurableByWorkspace[workspaceId]
          ?? DEFAULT_RIGHT_PANEL_DURABLE_STATE;
        return {
          rightPanelDurableByWorkspace: {
            ...state.rightPanelDurableByWorkspace,
            [workspaceId]: {
              ...current,
              width: clampRightPanelWidth(resolveStateValue(value, current.width)),
            },
          },
        };
      });
    },

    setRightPanelOpenForWorkspace: (workspaceId, value) => {
      set((state) => {
        const current = state.rightPanelDurableByWorkspace[workspaceId]
          ?? DEFAULT_RIGHT_PANEL_DURABLE_STATE;
        return {
          rightPanelDurableByWorkspace: {
            ...state.rightPanelDurableByWorkspace,
            [workspaceId]: {
              ...current,
              open: resolveStateValue(value, current.open),
            },
          },
        };
      });
    },

    setPendingBackgroundSubagentSelectionForWorkspace: (workspaceId, selection) => {
      set((state) => ({
        pendingBackgroundSubagentSelectionByWorkspace: {
          ...state.pendingBackgroundSubagentSelectionByWorkspace,
          [workspaceId]: selection,
        },
      }));
    },

    clearPendingBackgroundSubagentSelectionForWorkspace: (workspaceId) => {
      set((state) => ({
        pendingBackgroundSubagentSelectionByWorkspace: {
          ...state.pendingBackgroundSubagentSelectionByWorkspace,
          [workspaceId]: null,
        },
      }));
    },

    // Finish-signal ladder rung 1 — "clears on select": `BackgroundWorkPane`
    // calls this the instant it is actually open (not merely mounted), and
    // again on every new finish observed while it stays open, so the dot
    // never re-lights for work the pane already showed live.
    markBackgroundWorkViewedForSession: (sessionId, atMs) => {
      set((state) => ({
        backgroundWorkLastViewedAtBySession: {
          ...state.backgroundWorkLastViewedAtBySession,
          [sessionId]: atMs ?? Date.now(),
        },
      }));
    },

    // Finish-signal ladder rungs 1-2 — the durable record `chips.ts`'s
    // "subagents leave the roster on finish" comment forward-references:
    // the only place a finished-and-vanished subagent's last snapshot
    // survives. Monotonic per session — a later observation never regresses
    // an already-recorded finish.
    recordBackgroundWorkFinishedSubagentForSession: (sessionId, subagent, atMs) => {
      set((state) => {
        const current = state.backgroundWorkLastFinishedSubagentBySession[sessionId];
        if (current && current.atMs >= atMs) {
          return state;
        }
        return {
          backgroundWorkLastFinishedSubagentBySession: {
            ...state.backgroundWorkLastFinishedSubagentBySession,
            [sessionId]: { subagent, atMs },
          },
        };
      });
    },
  };
}
