import type { WorkspaceUiGet, WorkspaceUiSet, WorkspaceUiState } from "@/stores/preferences/workspace-ui-store-types";

type WorkspaceUiDismissalActions = Pick<
  WorkspaceUiState,
  | "dismissSetupFailure"
  | "clearSetupFailureDismissal"
>;

export function createWorkspaceUiDismissalActions(
  set: WorkspaceUiSet,
  get: WorkspaceUiGet,
): WorkspaceUiDismissalActions {
  return {
    dismissSetupFailure: (workspaceId) => {
      set({
        dismissedSetupFailures: {
          ...get().dismissedSetupFailures,
          [workspaceId]: true,
        },
      });
    },

    clearSetupFailureDismissal: (workspaceId) => {
      const current = { ...get().dismissedSetupFailures };
      delete current[workspaceId];
      set({ dismissedSetupFailures: current });
    },
  };
}
