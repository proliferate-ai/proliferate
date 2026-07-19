import { useCallback, useState } from "react";
import { APP_ROUTES } from "#product/config/app-routes";
import { useWorkspaceNavigationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useToastStore } from "#product/stores/toast/toast-store";

export function useWorkspaceSessionRecoveryActions() {
  const [isRetrying, setIsRetrying] = useState(false);
  const recovery = useSessionSelectionStore((state) => state.workspaceSessionRecovery);
  const showToast = useToastStore((state) => state.show);
  const { selectWorkspace } = useWorkspaceSelection();
  const { goToTopLevelRoute } = useWorkspaceNavigationWorkflow();

  const retry = useCallback(async () => {
    if (!recovery || isRetrying) {
      return;
    }
    setIsRetrying(true);
    try {
      await selectWorkspace(recovery.logicalWorkspaceId, {
        force: true,
        forceCold: true,
        initialActiveSessionId: null,
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to retry workspace selection.");
    } finally {
      setIsRetrying(false);
    }
  }, [isRetrying, recovery, selectWorkspace, showToast]);

  const reload = useCallback(() => {
    globalThis.location.reload();
  }, []);

  const backToWorkspaces = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.workspaces);
  }, [goToTopLevelRoute]);

  return {
    backToWorkspaces,
    isRetrying,
    recovery,
    reload,
    retry,
  };
}
