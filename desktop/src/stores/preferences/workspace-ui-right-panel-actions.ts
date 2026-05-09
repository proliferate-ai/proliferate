import type { SetStateAction } from "react";
import {
  clampRightPanelWidth,
  DEFAULT_RIGHT_PANEL_DURABLE_STATE,
  DEFAULT_RIGHT_PANEL_MATERIALIZED_STATE,
  normalizeRightPanelDurableState,
  type RightPanelWorkspaceState,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import { reconcileRightPanelWorkspaceState } from "@/lib/domain/workspaces/shell/right-panel-state";
import { resolveStateValue } from "@/stores/preferences/workspace-ui-state-value";
import type { WorkspaceUiSet, WorkspaceUiState } from "@/stores/preferences/workspace-ui-store-types";

type WorkspaceUiRightPanelActions = Pick<
  WorkspaceUiState,
  | "setRightPanelForWorkspace"
  | "setRightPanelDurableForWorkspace"
  | "setRightPanelMaterializedForWorkspace"
  | "setRightPanelWidthForWorkspace"
  | "setRightPanelOpenForWorkspace"
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
  };
}
