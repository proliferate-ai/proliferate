import { useEffect, useRef, type ReactNode } from "react"
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider"
import type { DesktopDiagnosticsBridge } from "@proliferate/product-client/host/desktop-bridge"

import { useConnectivityListeners } from "@/hooks/app/lifecycle/use-connectivity-listeners"
import { useDebugSessionActivity } from "@/hooks/app/lifecycle/use-debug-session-activity"
import { useDevDesktopHandoff } from "@/hooks/app/lifecycle/use-dev-desktop-handoff"
import { useProductEntryRouting } from "@/hooks/app/lifecycle/use-product-entry-routing"
import { useOrganizationJoinAuthLaunch } from "@/hooks/organizations/lifecycle/use-organization-join-auth-launch"
import { useAppShortcuts } from "@/hooks/app/lifecycle/use-app-shortcuts"
import { useAppCommandActions } from "@/hooks/app/workflows/use-app-command-actions"
import { useAgentAutoReconcile } from "@/hooks/agents/lifecycle/use-agent-auto-reconcile"
import { useFirstRunAuthAdoption } from "@/hooks/agents/lifecycle/use-first-run-auth-adoption"
import { useGatewayCatalogMirrorSync } from "@/hooks/agents/lifecycle/use-gateway-catalog-mirror-sync"
import { useLocalAuthStateSync } from "@/hooks/agents/lifecycle/use-local-auth-state-sync"
import { useLocalAutomationExecutor } from "@/hooks/automations/lifecycle/use-local-automation-executor"
import { useHomeDeferredLaunchRunner } from "@/hooks/home/lifecycle/use-home-deferred-launch-runner"
import { useAppearancePreferenceLifecycle } from "@/hooks/preferences/lifecycle/use-appearance-preference-lifecycle"
import { useRepoPreferencesLifecycle } from "@/hooks/preferences/lifecycle/use-repo-preferences-lifecycle"
import { useUserPreferencesLifecycle } from "@/hooks/preferences/lifecycle/use-user-preferences-lifecycle"
import { useWorkspaceUiLifecycle } from "@/hooks/preferences/lifecycle/use-workspace-ui-lifecycle"
import { useProductStoragePersistenceLifecycle } from "@/hooks/persistence/lifecycle/use-product-storage-persistence-lifecycle"
import { useSessionIntentDispatcher } from "@/hooks/sessions/lifecycle/use-session-intent-dispatcher"
import { useSessionSelectionLifecycle } from "@/hooks/sessions/lifecycle/use-session-selection-lifecycle"
import { useShortcutDispatcher } from "@/hooks/shortcuts/lifecycle/use-shortcut-dispatcher"
import { useSupportReportUploadQueue } from "@/hooks/support/lifecycle/use-support-report-upload-queue"
import { useTurnEndSound } from "@/hooks/sessions/lifecycle/use-turn-end-sound"
import { useWorkspaceGitStatusPersistence } from "@/hooks/workspaces/lifecycle/use-workspace-git-status-persistence"
import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
} from "@/lib/infra/measurement/debug-startup"
import {
  recordBootDiagnostic,
  recordBootDiagnosticOnce,
} from "@/lib/infra/measurement/boot-stall-diagnostics"
import { AppCommandActionsProvider } from "@/providers/AppCommandActionsProvider"
import { DesktopProductLifecycleRoot } from "@/providers/DesktopProductLifecycleRoot"
import { useProductAuthStatus } from "@/hooks/auth/facade/use-product-auth"

const APP_RUNTIME_RENDER_MILESTONES = new Set([1, 2, 3, 5, 10, 25, 50, 100, 250])

let appRuntimeRenderCount = 0

function recordAppRendererEvent(
  diagnostics: DesktopDiagnosticsBridge | null,
  message: string,
  elapsedMs?: number,
): void {
  recordBootDiagnostic(
    `app_bootstrap.${message}`,
    elapsedMs === undefined ? undefined : { elapsedMs },
  )
  void diagnostics?.logEvent({
    source: "app_bootstrap",
    message,
    elapsedMs,
  }).catch(() => {
    // Native logging is diagnostic-only; app startup should never depend on it.
  })
}

/**
 * Product-owned lifecycle root. Mounts the shared product lifecycle hooks (in
 * the exact order and boot-diagnostic bracketing the app has always used),
 * drives the auth restore effect, and mounts the capability-gated
 * `DesktopProductLifecycleRoot` (which itself renders nothing on a non-Desktop
 * host). It renders the product route/UI tree (`children`) beneath the
 * `AppCommandActionsProvider` it owns.
 */
export function ProductLifecycleRoot({ children }: { children: ReactNode }) {
  appRuntimeRenderCount += 1
  if (APP_RUNTIME_RENDER_MILESTONES.has(appRuntimeRenderCount)) {
    recordBootDiagnostic("app_runtime.render.pass", { count: appRuntimeRenderCount })
  }
  recordBootDiagnosticOnce("app_runtime.render.before.use_auth_bootstrap")
  const productHost = useProductHost()
  const bootstrapAuth = productHost.auth.restoreSession
  const diagnostics = productHost.desktop?.diagnostics ?? null
  recordBootDiagnosticOnce("app_runtime.render.after.use_auth_bootstrap")
  recordBootDiagnosticOnce("app_runtime.render.before.auth_status")
  const authStatus = useProductAuthStatus()
  const authStatusRef = useRef(authStatus)
  authStatusRef.current = authStatus
  recordBootDiagnosticOnce("app_runtime.render.after.auth_status", { authStatus })
  recordBootDiagnosticOnce("app_runtime.render.before.use_app_command_actions")
  const appCommandActions = useAppCommandActions()
  recordBootDiagnosticOnce("app_runtime.render.after.use_app_command_actions")
  useConnectivityListeners()
  useDebugSessionActivity()
  useDevDesktopHandoff()
  // Mounted here — above the auth route gate — so invitation/login-dependent
  // inbound entries reach the shared gate rather than being blocked by it.
  useProductEntryRouting()
  useOrganizationJoinAuthLaunch()
  recordBootDiagnosticOnce("app_runtime.render.before.use_shortcut_dispatcher")
  useShortcutDispatcher()
  recordBootDiagnosticOnce("app_runtime.render.after.use_shortcut_dispatcher")
  recordBootDiagnosticOnce("app_runtime.render.before.use_app_shortcuts")
  useAppShortcuts(appCommandActions)
  recordBootDiagnosticOnce("app_runtime.render.after.use_app_shortcuts")
  recordBootDiagnosticOnce("app_runtime.render.before.use_turn_end_sound")
  useTurnEndSound()
  recordBootDiagnosticOnce("app_runtime.render.after.use_turn_end_sound")
  recordBootDiagnosticOnce("app_runtime.render.before.use_agent_auto_reconcile")
  useAgentAutoReconcile()
  recordBootDiagnosticOnce("app_runtime.render.after.use_agent_auto_reconcile")
  recordBootDiagnosticOnce("app_runtime.render.before.use_first_run_auth_adoption")
  useFirstRunAuthAdoption()
  recordBootDiagnosticOnce("app_runtime.render.after.use_first_run_auth_adoption")
  recordBootDiagnosticOnce("app_runtime.render.before.use_local_auth_state_sync")
  useLocalAuthStateSync()
  recordBootDiagnosticOnce("app_runtime.render.after.use_local_auth_state_sync")
  recordBootDiagnosticOnce("app_runtime.render.before.use_gateway_catalog_mirror_sync")
  useGatewayCatalogMirrorSync()
  recordBootDiagnosticOnce("app_runtime.render.after.use_gateway_catalog_mirror_sync")
  recordBootDiagnosticOnce("app_runtime.render.before.use_local_automation_executor")
  useLocalAutomationExecutor()
  recordBootDiagnosticOnce("app_runtime.render.after.use_local_automation_executor")
  recordBootDiagnosticOnce("app_runtime.render.before.use_home_deferred_launch_runner")
  useHomeDeferredLaunchRunner()
  recordBootDiagnosticOnce("app_runtime.render.after.use_home_deferred_launch_runner")
  recordBootDiagnosticOnce("app_runtime.render.before.use_user_preferences_lifecycle")
  useUserPreferencesLifecycle()
  recordBootDiagnosticOnce("app_runtime.render.after.use_user_preferences_lifecycle")
  recordBootDiagnosticOnce("app_runtime.render.before.use_appearance_preference_lifecycle")
  useAppearancePreferenceLifecycle()
  recordBootDiagnosticOnce("app_runtime.render.after.use_appearance_preference_lifecycle")
  recordBootDiagnosticOnce("app_runtime.render.before.use_repo_preferences_lifecycle")
  useRepoPreferencesLifecycle()
  recordBootDiagnosticOnce("app_runtime.render.after.use_repo_preferences_lifecycle")
  recordBootDiagnosticOnce("app_runtime.render.before.use_workspace_ui_lifecycle")
  useWorkspaceUiLifecycle()
  recordBootDiagnosticOnce("app_runtime.render.after.use_workspace_ui_lifecycle")
  recordBootDiagnosticOnce("app_runtime.render.before.use_workspace_git_status_persistence")
  useWorkspaceGitStatusPersistence()
  recordBootDiagnosticOnce("app_runtime.render.after.use_workspace_git_status_persistence")
  recordBootDiagnosticOnce("app_runtime.render.before.use_session_intent_dispatcher")
  useSessionIntentDispatcher()
  recordBootDiagnosticOnce("app_runtime.render.after.use_session_intent_dispatcher")
  recordBootDiagnosticOnce("app_runtime.render.before.use_session_selection_lifecycle")
  useSessionSelectionLifecycle()
  recordBootDiagnosticOnce("app_runtime.render.after.use_session_selection_lifecycle")
  recordBootDiagnosticOnce("app_runtime.render.before.use_support_report_upload_queue")
  useSupportReportUploadQueue()
  recordBootDiagnosticOnce("app_runtime.render.after.use_support_report_upload_queue")
  recordBootDiagnosticOnce("app_runtime.render.before.use_product_storage_persistence_lifecycle")
  useProductStoragePersistenceLifecycle()
  recordBootDiagnosticOnce("app_runtime.render.after.use_product_storage_persistence_lifecycle")

  useEffect(() => {
    recordAppRendererEvent(diagnostics, "app.bootstrap.start")
    logStartupDebug("app.bootstrap.start")
    const authBootstrapStartedAt = startStartupTimer()
    recordAppRendererEvent(diagnostics, "app.auth_bootstrap.start")
    logStartupDebug("app.auth_bootstrap.start")
    void bootstrapAuth().finally(() => {
      recordAppRendererEvent(
        diagnostics,
        "app.auth_bootstrap.completed",
        elapsedStartupMs(authBootstrapStartedAt),
      )
      logStartupDebug("app.auth_bootstrap.completed", {
        elapsedMs: elapsedStartupMs(authBootstrapStartedAt),
        authStatus: authStatusRef.current,
      })
    })
  }, [bootstrapAuth, diagnostics])

  recordBootDiagnosticOnce("app_runtime.render.before_return", { authStatus })

  return (
    <AppCommandActionsProvider value={appCommandActions}>
      <DesktopProductLifecycleRoot />
      {children}
    </AppCommandActionsProvider>
  )
}
