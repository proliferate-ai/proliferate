import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { APP_ROUTES } from "@/config/app-routes";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useWebAppTarget } from "@/hooks/capabilities/derived/use-web-app-target";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { useOpenSupportReportWindow } from "@/hooks/support/workflows/use-open-support-report-window";
import { useKeyboardShortcutsDialogStore } from "@/stores/shortcuts/keyboard-shortcuts-dialog-store";
import { useToastStore } from "@/stores/toast/toast-store";
import type { AppCommandActions } from "./app-command-action-types";

export type AppNavigationCommandActions = Pick<
  AppCommandActions,
  | "openSettings"
  | "showKeyboardShortcuts"
  | "goHome"
  | "goWorkflows"
  | "openWebApp"
  | "openSupport"
>;

// Owns top-level app navigation/support commands shared by shortcuts and palette actions.
export function useAppNavigationCommandActions(): AppNavigationCommandActions {
  const navigate = useNavigate();
  const showToast = useToastStore((state) => state.show);
  const { openExternal } = useTauriShellActions();
  const webApp = useWebAppTarget();
  const { goToTopLevelRoute } = useWorkspaceNavigationWorkflow();

  const openSettings = useCallback(() => {
    navigate("/settings");
  }, [navigate]);
  const openShortcutsDialog = useKeyboardShortcutsDialogStore((state) => state.setOpen);
  const showKeyboardShortcuts = useCallback(() => {
    openShortcutsDialog(true);
  }, [openShortcutsDialog]);
  const goHome = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.home);
  }, [goToTopLevelRoute]);
  const goWorkflows = useCallback(() => {
    goToTopLevelRoute(APP_ROUTES.workflows);
  }, [goToTopLevelRoute]);
  const webAppBaseUrl = webApp.baseUrl;
  const openWebApp = useCallback(() => {
    if (!webAppBaseUrl) {
      showToast("The web app is not available for this server.");
      return;
    }
    showToast("Opening web app...", "info");
    void openExternal(webAppBaseUrl).catch(() => {
      showToast("Failed to open the web app.");
    });
  }, [openExternal, showToast, webAppBaseUrl]);
  const {
    openBug: openSupport,
    disabledReason: supportDisabledReason,
  } = useOpenSupportReportWindow({ source: "sidebar" });

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
    goWorkflows: {
      execute: goWorkflows,
      disabledReason: null,
    },
    openWebApp: {
      execute: openWebApp,
      disabledReason: webApp.available
        ? null
        : "The web app is not available for this server.",
    },
    openSupport: {
      execute: openSupport,
      disabledReason: supportDisabledReason,
    },
  }), [
    goHome,
    goWorkflows,
    openSettings,
    openSupport,
    supportDisabledReason,
    openWebApp,
    webApp.available,
    showKeyboardShortcuts,
  ]);
}
