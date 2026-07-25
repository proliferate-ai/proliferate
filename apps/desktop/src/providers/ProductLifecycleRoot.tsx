import { useEffect, useRef, type ReactNode } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type { DesktopDiagnosticsBridge } from "@proliferate/product-client/host/desktop-diagnostics-bridge";

import { useConnectivityListeners } from "@/hooks/app/lifecycle/use-connectivity-listeners";
import { useProductEntryRouting } from "@/hooks/app/lifecycle/use-product-entry-routing";
import { useOrganizationJoinAuthLaunch } from "@/hooks/organizations/lifecycle/use-organization-join-auth-launch";
import { useAppShortcuts } from "@/hooks/app/lifecycle/use-app-shortcuts";
import { useAppCommandActions } from "@/hooks/app/workflows/use-app-command-actions";
import { useHomeDeferredLaunchRunner } from "@/hooks/home/lifecycle/use-home-deferred-launch-runner";
import { useAppearancePreferenceLifecycle } from "@/hooks/preferences/lifecycle/use-appearance-preference-lifecycle";
import { useProductPersistenceLifecycles } from "@/hooks/preferences/lifecycle/use-product-persistence-lifecycles";
import { useSessionIntentDispatcher } from "@/hooks/sessions/lifecycle/use-session-intent-dispatcher";
import { useShortcutDispatcher } from "@/hooks/shortcuts/lifecycle/use-shortcut-dispatcher";
import { useSupportReportUploadQueue } from "@/hooks/support/lifecycle/use-support-report-upload-queue";
import { useTurnEndSound } from "@/hooks/sessions/lifecycle/use-turn-end-sound";
import { useTerminalStreamAuthorityLifecycle } from "@/hooks/terminals/lifecycle/use-terminal-stream-authority-lifecycle";
import { useWorkspaceGitStatusPersistence } from "@/hooks/workspaces/lifecycle/use-workspace-git-status-persistence";

import { AppCommandActionsProvider } from "./AppCommandActionsProvider";
import { DesktopProductLifecycleRoot } from "./DesktopProductLifecycleRoot";

const APP_RUNTIME_RENDER_MILESTONES = new Set([1, 2, 3, 5, 10, 25, 50, 100, 250]);

let appRuntimeRenderCount = 0;

function recordBootEvent(
  diagnostics: DesktopDiagnosticsBridge | null,
  label: string,
  metadata?: Record<string, unknown>,
): void {
  diagnostics?.recordBootEvent({ label, metadata });
}

function recordBootEventOnce(
  diagnostics: DesktopDiagnosticsBridge | null,
  label: string,
  metadata?: Record<string, unknown>,
): void {
  diagnostics?.recordBootEventOnce({ label, metadata });
}

/** Product-owned mounted behavior shared by Desktop and the later Web host. */
export function ProductLifecycleRoot({ children }: { children: ReactNode }) {
  const host = useProductHost();
  const diagnostics = host.desktop?.diagnostics ?? null;
  if (diagnostics !== null) {
    appRuntimeRenderCount += 1;
    if (APP_RUNTIME_RENDER_MILESTONES.has(appRuntimeRenderCount)) {
      recordBootEvent(diagnostics, "app_runtime.render.pass", {
        count: appRuntimeRenderCount,
      });
    }
  }

  recordBootEventOnce(diagnostics, "app_runtime.render.before.use_auth_bootstrap");
  const bootstrapAuth = host.auth.restoreSession;
  const authStateRef = useRef(host.auth.state);
  authStateRef.current = host.auth.state;
  recordBootEventOnce(diagnostics, "app_runtime.render.after.use_auth_bootstrap");
  recordBootEventOnce(diagnostics, "app_runtime.render.before.auth_status");
  const authStatus = host.auth.state.status;
  recordBootEventOnce(diagnostics, "app_runtime.render.after.auth_status", {
    authStatus,
  });

  recordBootEventOnce(diagnostics, "app_runtime.render.before.use_app_command_actions");
  const appCommandActions = useAppCommandActions();
  recordBootEventOnce(diagnostics, "app_runtime.render.after.use_app_command_actions");
  useConnectivityListeners();
  useProductEntryRouting();
  useOrganizationJoinAuthLaunch();
  recordBootEventOnce(diagnostics, "app_runtime.render.before.use_shortcut_dispatcher");
  useShortcutDispatcher();
  recordBootEventOnce(diagnostics, "app_runtime.render.after.use_shortcut_dispatcher");
  recordBootEventOnce(diagnostics, "app_runtime.render.before.use_app_shortcuts");
  useAppShortcuts(appCommandActions);
  recordBootEventOnce(diagnostics, "app_runtime.render.after.use_app_shortcuts");
  recordBootEventOnce(diagnostics, "app_runtime.render.before.use_turn_end_sound");
  useTurnEndSound();
  recordBootEventOnce(diagnostics, "app_runtime.render.after.use_turn_end_sound");
  recordBootEventOnce(diagnostics, "app_runtime.render.before.use_home_deferred_launch_runner");
  useHomeDeferredLaunchRunner();
  recordBootEventOnce(diagnostics, "app_runtime.render.after.use_home_deferred_launch_runner");
  recordBootEventOnce(diagnostics, "app_runtime.render.before.use_user_preferences_lifecycle");
  recordBootEventOnce(diagnostics, "app_runtime.render.before.use_repo_preferences_lifecycle");
  recordBootEventOnce(diagnostics, "app_runtime.render.before.use_workspace_ui_lifecycle");
  recordBootEventOnce(diagnostics, "app_runtime.render.before.use_session_selection_lifecycle");
  useProductPersistenceLifecycles();
  recordBootEventOnce(diagnostics, "app_runtime.render.after.use_user_preferences_lifecycle");
  recordBootEventOnce(diagnostics, "app_runtime.render.after.use_repo_preferences_lifecycle");
  recordBootEventOnce(diagnostics, "app_runtime.render.after.use_workspace_ui_lifecycle");
  recordBootEventOnce(diagnostics, "app_runtime.render.after.use_session_selection_lifecycle");
  recordBootEventOnce(diagnostics, "app_runtime.render.before.use_appearance_preference_lifecycle");
  useAppearancePreferenceLifecycle();
  recordBootEventOnce(diagnostics, "app_runtime.render.after.use_appearance_preference_lifecycle");
  recordBootEventOnce(diagnostics, "app_runtime.render.before.use_workspace_git_status_persistence");
  useWorkspaceGitStatusPersistence();
  recordBootEventOnce(diagnostics, "app_runtime.render.after.use_workspace_git_status_persistence");
  recordBootEventOnce(diagnostics, "app_runtime.render.before.use_session_intent_dispatcher");
  useSessionIntentDispatcher();
  recordBootEventOnce(diagnostics, "app_runtime.render.after.use_session_intent_dispatcher");
  recordBootEventOnce(diagnostics, "app_runtime.render.before.use_support_report_upload_queue");
  useSupportReportUploadQueue();
  recordBootEventOnce(diagnostics, "app_runtime.render.after.use_support_report_upload_queue");
  useTerminalStreamAuthorityLifecycle();

  useEffect(() => {
    diagnostics?.recordStartupEvent({ message: "app.bootstrap.start" });
    const authBootstrapStartedAt = performance.now();
    diagnostics?.recordStartupEvent({ message: "app.auth_bootstrap.start" });
    void bootstrapAuth().finally(() => {
      diagnostics?.recordStartupEvent({
        message: "app.auth_bootstrap.completed",
        elapsedMs: Math.round(performance.now() - authBootstrapStartedAt),
        authStatus: authStateRef.current.status,
      });
    });
  }, [bootstrapAuth, diagnostics]);

  recordBootEventOnce(diagnostics, "app_runtime.render.before_return", {
    authStatus,
  });

  return (
    <AppCommandActionsProvider value={appCommandActions}>
      {host.desktop !== null ? <DesktopProductLifecycleRoot /> : null}
      {children}
    </AppCommandActionsProvider>
  );
}
