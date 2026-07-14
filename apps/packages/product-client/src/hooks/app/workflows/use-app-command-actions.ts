import { useMemo } from "react";
import type { AppCommandActions } from "#product/hooks/app/workflows/app-command-action-types";
import { useAppAddRepositoryCommandAction } from "#product/hooks/app/workflows/use-app-add-repository-command-action";
import { useAppNavigationCommandActions } from "#product/hooks/app/workflows/use-app-navigation-command-actions";
import { useAppNewWorkspaceCommandActions } from "#product/hooks/app/workflows/use-app-new-workspace-command-actions";
import { useAppWorkspaceCopyCommandActions } from "#product/hooks/app/workflows/use-app-workspace-copy-command-actions";

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
