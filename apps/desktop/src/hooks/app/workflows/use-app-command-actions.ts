import { useMemo } from "react";
import type { AppCommandActions } from "./app-command-action-types";
import { useAppAddRepositoryCommandAction } from "./use-app-add-repository-command-action";
import { useAppNavigationCommandActions } from "./use-app-navigation-command-actions";
import { useAppNewWorkspaceCommandActions } from "./use-app-new-workspace-command-actions";
import { useAppWorkspaceCopyCommandActions } from "./use-app-workspace-copy-command-actions";

// Owns global app command callbacks for shortcuts and the command palette.
// Focused command hooks wire each workflow slice into one command surface.
export function useAppCommandActions(): AppCommandActions {
  const navigationActions = useAppNavigationCommandActions();
  const addRepository = useAppAddRepositoryCommandAction();
  const newWorkspaceActions = useAppNewWorkspaceCommandActions();
  const copyActions = useAppWorkspaceCopyCommandActions();

  return useMemo<AppCommandActions>(() => ({
    ...navigationActions,
    addRepository,
    ...newWorkspaceActions,
    ...copyActions,
  }), [
    addRepository,
    copyActions,
    navigationActions,
    newWorkspaceActions,
  ]);
}
