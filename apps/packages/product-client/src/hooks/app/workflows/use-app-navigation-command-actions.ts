import { useCallback, useMemo } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { APP_ROUTES } from "#product/config/app-routes";
import { isWorkflowsV2Enabled } from "#product/lib/domain/capabilities/workflows-v2";
import { navigateApp } from "#product/lib/workflows/app/app-navigate-handoff";
import {
  SETTINGS_NAV_FLOW_KEY,
  beginRendererFlow,
} from "#product/lib/infra/diagnostics/renderer-flow-timing";
import { useWebAppTarget } from "#product/hooks/capabilities/derived/use-web-app-target";
import { useWorkspaceNavigationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-navigation-workflow";
import { useOpenSupportReportWindow } from "#product/hooks/support/workflows/use-open-support-report-window";
import { useSupportMenuAction } from "#product/hooks/support/derived/use-support-menu-action";
import { useKeyboardShortcutsDialogStore } from "#product/stores/shortcuts/keyboard-shortcuts-dialog-store";
import { useToastStore } from "#product/stores/toast/toast-store";
import type { AppCommandAction, AppCommandActions } from "#product/hooks/app/workflows/app-command-action-types";

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
  const showToast = useToastStore((state) => state.show);
  const { openExternal } = useProductHost().links;
  const webApp = useWebAppTarget();
  const { goToTopLevelRoute } = useWorkspaceNavigationWorkflow();

  // navigateApp instead of useNavigate: these are callback-only commands, and
  // useNavigate would subscribe every command surface (and the lifecycle root
  // composing them) to each location change (PRO-170, PRO-182).
  const openSettings = useCallback(() => {
    // UX-latency R1: intent mark for the settings_nav flow. The shell/data/
    // stable marks are emitted by SettingsScreen once it mounts and settles.
    // COVERAGE LIMIT (honest): only THIS command path emits the intent mark.
    // Opening settings via a direct URL, a page reload, or a deep link does not
    // run this callback, so those routes emit no settings_nav flow at all (the
    // settle marks in SettingsScreen then no-op against a missing flow). This
    // rung measures the in-app command/palette/shortcut path only.
    beginRendererFlow({ kind: "settings_nav", correlationKey: SETTINGS_NAV_FLOW_KEY });
    navigateApp("/settings?section=account");
  }, []);
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
  // Same treatment as the sidebar row: while the workflows_v2 gate is off the
  // command is not offered at all, rather than offered and landing on the
  // deliberately unavailable page.
  const workflowsHidden = !isWorkflowsV2Enabled();
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
      hidden: workflowsHidden,
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
    openSettings,
    openSupportAction,
    openWebApp,
    webApp.available,
    workflowsHidden,
    showKeyboardShortcuts,
  ]);
}
