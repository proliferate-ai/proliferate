import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { APP_ROUTES } from "@/config/app-routes";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import { getProliferateWebBaseUrl } from "@/lib/infra/proliferate-web";
import { requestSupportDialog } from "@/lib/infra/support/support-dialog-request";
import { useToastStore } from "@/stores/toast/toast-store";
import type { AppCommandActions } from "./app-command-action-types";

export type AppNavigationCommandActions = Pick<
  AppCommandActions,
  | "openSettings"
  | "showKeyboardShortcuts"
  | "goHome"
  | "goIntegrations"
  | "goWorkflows"
  | "openWebApp"
  | "openSupport"
>;

// Owns top-level app navigation/support commands shared by shortcuts and palette actions.
export function useAppNavigationCommandActions(): AppNavigationCommandActions {
  const navigate = useNavigate();
  const showToast = useToastStore((state) => state.show);
  const { openExternal } = useTauriShellActions();
  const { goToTopLevelRoute } = useWorkspaceNavigationWorkflow();

  const openSettings = useCallback(() => {
    navigate("/settings");
  }, [navigate]);
  const showKeyboardShortcuts = useCallback(() => {
    navigate(buildSettingsHref({ section: "keyboard" }));
  }, [navigate]);
  const goHome = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.home);
  }, [goToTopLevelRoute]);
  const goIntegrations = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.integrations);
  }, [goToTopLevelRoute]);
  const goWorkflows = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.workflows);
  }, [goToTopLevelRoute]);
  const openWebApp = useCallback(() => {
    showToast("Opening web app...", "info");
    void openExternal(getProliferateWebBaseUrl()).catch(() => {
      showToast("Failed to open the web app.");
    });
  }, [openExternal, showToast]);
  const openSupport = useCallback(() => {
    requestSupportDialog();
  }, []);

  return useMemo<AppNavigationCommandActions>(() => ({
    openSettings: {
      execute: openSettings,
      disabledReason: null,
    },
    showKeyboardShortcuts: {
      execute: showKeyboardShortcuts,
      disabledReason: null,
    },
    goHome: {
      execute: goHome,
      disabledReason: null,
    },
    goIntegrations: {
      execute: goIntegrations,
      disabledReason: null,
    },
    goWorkflows: {
      execute: goWorkflows,
      disabledReason: null,
    },
    openWebApp: {
      execute: openWebApp,
      disabledReason: null,
    },
    openSupport: {
      execute: openSupport,
      disabledReason: null,
    },
  }), [
    goHome,
    goIntegrations,
    goWorkflows,
    openSettings,
    openSupport,
    openWebApp,
    showKeyboardShortcuts,
  ]);
}
