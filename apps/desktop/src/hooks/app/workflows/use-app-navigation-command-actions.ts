import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { APP_ROUTES } from "@/config/app-routes";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useWebAppTarget } from "@/hooks/capabilities/derived/use-web-app-target";
import { useWorkspaceNavigationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { useOpenSupportReportWindow } from "@/hooks/support/workflows/use-open-support-report-window";
import { useSupportMenuAction } from "@/hooks/support/derived/use-support-menu-action";
import { useKeyboardShortcutsDialogStore } from "@/stores/shortcuts/keyboard-shortcuts-dialog-store";
import { useToastStore } from "@/stores/toast/toast-store";
import type { AppCommandAction, AppCommandActions } from "./app-command-action-types";
import { useWorkflowsEnabled } from "@/hooks/access/cloud/use-server-features";

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
  const workflowsEnabled = useWorkflowsEnabled();
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
  const supportMenuAction = useSupportMenuAction();
  const openExternalSupportUrl = useCallback((url: string) => {
    void openExternal(url).catch(() => {
      showToast("Failed to open the link.");
    });
  }, [openExternal, showToast]);

  // Mirrors the sidebar's support routing (`SidebarHelpSection`): vendor
  // keeps the auth-gated feedback modal, operator routes straight to the
  // configured destination, and none hides the action entirely rather than
  // offering it disabled.
  const openSupportAction = useMemo<AppCommandAction>(() => {
    if (supportMenuAction.kind === "operator") {
      return {
        execute: () => openExternalSupportUrl(supportMenuAction.url),
        disabledReason: null,
      };
    }
    if (supportMenuAction.kind === "none") {
      return {
        execute: () => {},
        disabledReason: null,
        hidden: true,
      };
    }
    return {
      execute: openSupport,
      disabledReason: supportDisabledReason,
    };
  }, [openExternalSupportUrl, openSupport, supportDisabledReason, supportMenuAction]);

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
      // D-003 launch flag: hidden entirely (palette entry unregistered,
      // shortcut inert) when the server holds workflows dark.
      hidden: !workflowsEnabled,
    },
    openWebApp: {
      execute: openWebApp,
      disabledReason: webApp.available
        ? null
        : "The web app is not available for this server.",
    },
    openSupport: openSupportAction,
  }), [
    goHome,
    goWorkflows,
    workflowsEnabled,
    openSettings,
    openSupportAction,
    openWebApp,
    webApp.available,
    showKeyboardShortcuts,
  ]);
}
