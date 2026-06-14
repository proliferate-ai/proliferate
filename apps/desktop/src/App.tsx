import { Suspense, lazy, useEffect } from "react"
import { Navigate, Route, useLocation } from "react-router-dom"
import { RedirectCallbackScreen } from "@proliferate/product-ui/auth/RedirectCallbackScreen"
import { BootstrappedRoute, PublicOnlyRoute } from "@/components/auth/AuthGate"
import { AuthRequiredGate } from "@/components/auth/AuthRequiredGate"
import { UserPreferencesGate } from "@/components/app/UserPreferencesGate"
import { ToastContainer } from "@/components/feedback/Toast"
import { TurnEndCelebration } from "@/components/feedback/TurnEndCelebration"
import { UpdateRestartDialog } from "@/components/feedback/UpdateRestartDialog"
import { MacWindowControlsSafeArea } from "@/components/app/chrome/MacWindowControlsSafeArea"
import { useDebugSessionActivity } from "@/hooks/app/lifecycle/use-debug-session-activity"
import { useExportRunningAgentCount } from "@/hooks/app/lifecycle/use-export-running-agent-count"
import { useWorkspaceActivityIndicator } from "@/hooks/app/lifecycle/use-workspace-activity-indicator"
import { useAppShortcuts } from "@/hooks/app/lifecycle/use-app-shortcuts"
import { useAppCommandActions } from "@/hooks/app/workflows/use-app-command-actions"
import { useAuthBootstrap } from "@/hooks/auth/lifecycle/use-auth-bootstrap"
import { useAgentAutoReconcile } from "@/hooks/agents/lifecycle/use-agent-auto-reconcile"
import { useLocalAutomationExecutor } from "@/hooks/automations/lifecycle/use-local-automation-executor"
import { useHomeDeferredLaunchRunner } from "@/hooks/home/lifecycle/use-home-deferred-launch-runner"
import { useRuntimeInputSyncRuntime } from "@/hooks/cloud/lifecycle/use-runtime-input-sync-runtime"
import { useAppearancePreferenceLifecycle } from "@/hooks/preferences/lifecycle/use-appearance-preference-lifecycle"
import { useRepoPreferencesLifecycle } from "@/hooks/preferences/lifecycle/use-repo-preferences-lifecycle"
import { useUserPreferencesLifecycle } from "@/hooks/preferences/lifecycle/use-user-preferences-lifecycle"
import { useWorkspaceUiLifecycle } from "@/hooks/preferences/lifecycle/use-workspace-ui-lifecycle"
import { useSessionIntentDispatcher } from "@/hooks/sessions/lifecycle/use-session-intent-dispatcher"
import { useSessionSelectionLifecycle } from "@/hooks/sessions/lifecycle/use-session-selection-lifecycle"
import { useShortcutDispatcher } from "@/hooks/shortcuts/lifecycle/use-shortcut-dispatcher"
import { useSupportReportUploadQueue } from "@/hooks/support/lifecycle/use-support-report-upload-queue"
import { useTurnEndSound } from "@/hooks/sessions/lifecycle/use-turn-end-sound"
import { useLocalWorktreeSettingsTarget } from "@/hooks/workspaces/facade/use-local-worktree-settings-target"
import { useWorktreeCleanupPolicySync } from "@/hooks/workspaces/lifecycle/use-worktree-cleanup-policy-sync"
import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
} from "@/lib/infra/measurement/debug-startup"
import {
  recordBootDiagnostic,
  recordBootDiagnosticOnce,
} from "@/lib/infra/measurement/boot-stall-diagnostics"
import { bootstrapHarnessRuntime } from "@/lib/access/anyharness/runtime-bootstrap"
import { AppErrorBoundary } from "@/components/app/AppErrorBoundary"
import { RepoSetupModalHost } from "@/components/workspace/repo-setup/RepoSetupModalHost"
import { InstrumentedRoutes } from "@/lib/integrations/telemetry/sentry"
import { logRendererEvent } from "@/lib/access/tauri/diagnostics"
import { AuthenticatedAppHost } from "@/pages/AuthenticatedAppHost"
import { LoginPage } from "@/pages/LoginPage"
import { useAuthStore } from "@/stores/auth/auth-store"
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store"
import { AppCommandActionsProvider } from "@/providers/AppCommandActionsProvider"
import { ShortcutRevealProvider } from "@/providers/ShortcutRevealProvider"

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"])
const APP_RUNTIME_RENDER_MILESTONES = new Set([1, 2, 3, 5, 10, 25, 50, 100, 250])

let appRuntimeRenderCount = 0

// Dev-only playground. Lazy-loaded with a DEV guard so neither this file
// nor any of its fixtures / transitive deps land in production bundles.
const ChatPlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("@/pages/ChatPlaygroundPage").then((m) => ({
        default: m.ChatPlaygroundPage,
      })),
    )
  : null

const UpdatePlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("@/pages/UpdatePlaygroundPage").then((m) => ({
        default: m.UpdatePlaygroundPage,
      })),
    )
  : null

const TabStripPlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("@/pages/TabStripPlaygroundPage").then((m) => ({
        default: m.TabStripPlaygroundPage,
      })),
    )
  : null

function isTauriDesktop(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
}

function desktopDeepLinkScheme(): "proliferate" | "proliferate-local" {
  return LOCALHOST_NAMES.has(window.location.hostname)
    ? "proliferate-local"
    : "proliferate"
}

function cloudSettingsPath(search: string): string {
  const nextParams = new URLSearchParams(search)
  nextParams.set("section", "billing")
  return `/settings?${nextParams.toString()}`
}

function cloudSettingsDeepLink(search: string): string {
  const url = new URL(`${desktopDeepLinkScheme()}://settings/cloud`)
  const params = new URLSearchParams(search)
  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function recordAppRendererEvent(message: string, elapsedMs?: number): void {
  recordBootDiagnostic(
    `app_bootstrap.${message}`,
    elapsedMs === undefined ? undefined : { elapsedMs },
  )
  void logRendererEvent({
    source: "app_bootstrap",
    message,
    elapsedMs,
  }).catch(() => {
    // Native logging is diagnostic-only; app startup should never depend on it.
  })
}

function StripeReturnHandoff({ deepLinkUrl }: { deepLinkUrl: string }) {
  useEffect(() => {
    window.location.replace(deepLinkUrl)
  }, [deepLinkUrl])

  return (
    <RedirectCallbackScreen
      title="Billing done"
      description="Redirecting to desktop app..."
      statusLabel="Billing redirect"
      variant="handoff"
      primaryAction={{
        label: "Click here if not redirected",
        onClick: () => window.location.assign(deepLinkUrl),
      }}
    />
  )
}

function SettingsCloudRedirect() {
  const location = useLocation()
  if (!isTauriDesktop()) {
    return <StripeReturnHandoff deepLinkUrl={cloudSettingsDeepLink(location.search)} />
  }

  return <Navigate to={cloudSettingsPath(location.search)} replace />
}

function App() {
  return (
    <AppErrorBoundary>
      <AppRuntime />
    </AppErrorBoundary>
  )
}

function AppRuntime() {
  appRuntimeRenderCount += 1
  if (APP_RUNTIME_RENDER_MILESTONES.has(appRuntimeRenderCount)) {
    recordBootDiagnostic("app_runtime.render.pass", { count: appRuntimeRenderCount })
  }
  recordBootDiagnosticOnce("app_runtime.render.before.use_auth_bootstrap")
  const bootstrapAuth = useAuthBootstrap()
  recordBootDiagnosticOnce("app_runtime.render.after.use_auth_bootstrap")
  recordBootDiagnosticOnce("app_runtime.render.before.auth_status")
  const authStatus = useAuthStore((s) => s.status)
  recordBootDiagnosticOnce("app_runtime.render.after.auth_status", { authStatus })
  recordBootDiagnosticOnce("app_runtime.render.before.use_app_command_actions")
  const appCommandActions = useAppCommandActions()
  recordBootDiagnosticOnce("app_runtime.render.after.use_app_command_actions")
  recordBootDiagnosticOnce("app_runtime.render.before.use_export_running_agent_count")
  useExportRunningAgentCount()
  recordBootDiagnosticOnce("app_runtime.render.after.use_export_running_agent_count")
  useDebugSessionActivity()
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
  recordBootDiagnosticOnce("app_runtime.render.before.use_session_intent_dispatcher")
  useSessionIntentDispatcher()
  recordBootDiagnosticOnce("app_runtime.render.after.use_session_intent_dispatcher")
  recordBootDiagnosticOnce("app_runtime.render.before.use_session_selection_lifecycle")
  useSessionSelectionLifecycle()
  recordBootDiagnosticOnce("app_runtime.render.after.use_session_selection_lifecycle")
  recordBootDiagnosticOnce("app_runtime.render.before.use_support_report_upload_queue")
  useSupportReportUploadQueue()
  recordBootDiagnosticOnce("app_runtime.render.after.use_support_report_upload_queue")

  useEffect(() => {
    recordAppRendererEvent("app.bootstrap.start")
    logStartupDebug("app.bootstrap.start")
    const authBootstrapStartedAt = startStartupTimer()
    recordAppRendererEvent("app.auth_bootstrap.start")
    logStartupDebug("app.auth_bootstrap.start")
    void bootstrapAuth().finally(() => {
      recordAppRendererEvent(
        "app.auth_bootstrap.completed",
        elapsedStartupMs(authBootstrapStartedAt),
      )
      logStartupDebug("app.auth_bootstrap.completed", {
        elapsedMs: elapsedStartupMs(authBootstrapStartedAt),
        authStatus: useAuthStore.getState().status,
      })
    })
  }, [bootstrapAuth])

  useEffect(() => {
    if (authStatus !== "bootstrapping") {
      const runtimeBootstrapStartedAt = startStartupTimer()
      recordAppRendererEvent("app.runtime_bootstrap.start")
      logStartupDebug("app.runtime_bootstrap.start", { authStatus })
      void bootstrapHarnessRuntime().finally(() => {
        recordAppRendererEvent(
          "app.runtime_bootstrap.completed",
          elapsedStartupMs(runtimeBootstrapStartedAt),
        )
        logStartupDebug("app.runtime_bootstrap.completed", {
          elapsedMs: elapsedStartupMs(runtimeBootstrapStartedAt),
          authStatus,
        })
      })
    }
  }, [authStatus])

  recordBootDiagnosticOnce("app_runtime.render.before_return", { authStatus })

  return (
    <>
      <AppCommandActionsProvider value={appCommandActions}>
        <ShortcutRevealProvider>
          <MacWindowControlsSafeArea />
          <UpdateRestartDialog />
          <WorkspaceActivityIndicatorMount />
          <RuntimeInputSyncGate />
          <WorktreeCleanupPolicySyncGate />
          <InstrumentedRoutes>
            <Route path="/index.html" element={<Navigate to="/" replace />} />
            <Route path="/settings/cloud" element={<SettingsCloudRedirect />} />
            <Route path="/settings/billing" element={<SettingsCloudRedirect />} />
            <Route element={<PublicOnlyRoute />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>
            <Route element={<BootstrappedRoute />}>
              <Route element={<AuthRequiredGate />}>
                <Route path="/setup" element={<Navigate to="/" replace />} />
                <Route element={<UserPreferencesGate />}>
                  <Route path="*" element={<AuthenticatedAppHost />} />
                </Route>
              </Route>
            </Route>
            {import.meta.env.DEV && ChatPlaygroundPage && (
              <Route
                path="/playground"
                element={
                  <Suspense fallback={null}>
                    <ChatPlaygroundPage />
                  </Suspense>
                }
              />
            )}
            {import.meta.env.DEV && UpdatePlaygroundPage && (
              <Route
                path="/playground/updates"
                element={
                  <Suspense fallback={null}>
                    <UpdatePlaygroundPage />
                  </Suspense>
                }
              />
            )}
            {import.meta.env.DEV && TabStripPlaygroundPage && (
              <Route
                path="/playground/tabs"
                element={
                  <Suspense fallback={null}>
                    <TabStripPlaygroundPage />
                  </Suspense>
                }
              />
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </InstrumentedRoutes>
          <RepoSetupModalHost />
          <ToastContainer />
          <TurnEndCelebration />
        </ShortcutRevealProvider>
      </AppCommandActionsProvider>
    </>
  )
}

function WorkspaceActivityIndicatorMount() {
  recordBootDiagnosticOnce("app_runtime.render.before.use_workspace_activity_indicator")
  useWorkspaceActivityIndicator()
  recordBootDiagnosticOnce("app_runtime.render.after.use_workspace_activity_indicator")
  return null
}

function RuntimeInputSyncGate() {
  const preferencesHydrated = useUserPreferencesStore((s) => s._hydrated)
  const cloudRuntimeInputSyncEnabled = useUserPreferencesStore(
    (s) => s.cloudRuntimeInputSyncEnabled,
  )

  if (!preferencesHydrated || !cloudRuntimeInputSyncEnabled) {
    return null
  }

  return <RuntimeInputSyncRuntimeMount />
}

function RuntimeInputSyncRuntimeMount() {
  useRuntimeInputSyncRuntime()
  return null
}

function WorktreeCleanupPolicySyncGate() {
  const preferencesHydrated = useUserPreferencesStore((s) => s._hydrated)

  if (!preferencesHydrated) {
    return null
  }

  return <WorktreeCleanupPolicySyncMount />
}

function WorktreeCleanupPolicySyncMount() {
  const settings = useLocalWorktreeSettingsTarget()
  useWorktreeCleanupPolicySync(settings.targets, settings.syncPolicyToTarget)
  return null
}

export default App
