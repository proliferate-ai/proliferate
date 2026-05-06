import { Suspense, lazy, useEffect } from "react"
import { Navigate, Route, useLocation } from "react-router-dom"
import { BootstrappedRoute, PublicOnlyRoute } from "@/components/auth/AuthGate"
import { AuthRequiredGate } from "@/components/auth/AuthRequiredGate"
import { UserPreferencesGate } from "@/components/app/UserPreferencesGate"
import { ToastContainer } from "@/components/feedback/Toast"
import { TurnEndCelebration } from "@/components/feedback/TurnEndCelebration"
import { UpdateRestartDialog } from "@/components/feedback/UpdateRestartDialog"
import { MacWindowControlsSafeArea } from "@/components/ui/MacWindowControlsSafeArea"
import { SessionModelAvailabilityDialog } from "@/components/workspace/chat/launch/SessionModelAvailabilityDialog"
import { applyAppearancePreference, initializeTheme } from "@/config/theme"
import { APP_ROUTES, LEGACY_APP_ROUTES } from "@/config/app-routes"
import { useAppCommandActions } from "@/hooks/app/use-app-command-actions"
import { useExportRunningAgentCount } from "@/hooks/app/use-export-running-agent-count"
import { useAppShortcuts } from "@/hooks/app/use-app-shortcuts"
import { useAuthBootstrap } from "@/hooks/auth/use-auth-bootstrap"
import { useAgentAutoReconcile } from "@/hooks/agents/use-agent-auto-reconcile"
import { useLocalAutomationExecutor } from "@/hooks/automations/use-local-automation-executor"
import { useRuntimeInputSyncRuntime } from "@/hooks/cloud/use-runtime-input-sync-runtime"
import { useHomeDeferredLaunchRunner } from "@/hooks/home/use-home-deferred-launch-runner"
import { usePendingWorkspaceQueuedPromptRunner } from "@/hooks/chat/use-pending-workspace-queued-prompt-runner"
import { useShortcutDispatcher } from "@/hooks/shortcuts/use-shortcut-dispatcher"
import { useTurnEndSound } from "@/hooks/sessions/use-turn-end-sound"
import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
} from "@/lib/infra/debug-startup"
import { bootstrapHarnessRuntime } from "@/lib/integrations/anyharness/runtime-bootstrap"
import { AppErrorBoundary } from "@/components/ui/AppErrorBoundary"
import { RepoSetupModalHost } from "@/components/workspace/repo-setup/RepoSetupModalHost"
import { InstrumentedRoutes } from "@/lib/integrations/telemetry/sentry"
import { logRendererEvent } from "@/platform/tauri/diagnostics"
import { AutomationDetailPage } from "@/pages/AutomationDetailPage"
import { AutomationsPage } from "@/pages/AutomationsPage"
import { LoginPage } from "@/pages/LoginPage"
import { MainPage } from "@/pages/MainPage"
import { PluginsPage } from "@/pages/PluginsPage"
import { SettingsPage } from "@/pages/SettingsPage"
import { useAuthStore } from "@/stores/auth/auth-store"
import {
  bootstrapUserPreferences,
  useUserPreferencesStore,
} from "@/stores/preferences/user-preferences-store"
import { bootstrapRepoPreferences } from "@/stores/preferences/repo-preferences-store"
import { bootstrapWorkspaceUi } from "@/stores/preferences/workspace-ui-store"
import { bootstrapLogicalWorkspaceSelection } from "@/stores/workspaces/logical-workspace-store"
import { AppCommandActionsProvider } from "@/providers/AppCommandActionsProvider"

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"])

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
  nextParams.set("section", "cloud")
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
    <div className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
      <main className="w-full max-w-sm space-y-4">
        <div className="space-y-2">
          <p className="text-base font-medium">Opening Proliferate...</p>
          <p className="text-sm text-muted-foreground">
            Stripe is done. Return to the desktop app to continue in Cloud settings.
          </p>
        </div>
        <a
          className="inline-flex w-full items-center justify-center rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background"
          href={deepLinkUrl}
        >
          Open Proliferate
        </a>
      </main>
    </div>
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
  const bootstrapAuth = useAuthBootstrap()
  const authStatus = useAuthStore((s) => s.status)
  const appCommandActions = useAppCommandActions()
  useExportRunningAgentCount()
  useShortcutDispatcher()
  useAppShortcuts(appCommandActions)
  useTurnEndSound()
  useAgentAutoReconcile()
  useLocalAutomationExecutor()
  useHomeDeferredLaunchRunner()
  usePendingWorkspaceQueuedPromptRunner()

  useEffect(() => {
    recordAppRendererEvent("app.bootstrap.start")
    logStartupDebug("app.bootstrap.start")
    initializeTheme()
    const applyStoredAppearance = () => {
      const {
        themePreset,
        colorMode,
        uiFontSizeId,
        readableCodeFontSizeId,
      } = useUserPreferencesStore.getState()
      applyAppearancePreference({
        themePreset,
        colorMode,
        uiFontSizeId,
        readableCodeFontSizeId,
      })
    }
    applyStoredAppearance()

    const unsubscribeAppearance = useUserPreferencesStore.subscribe((state, prev) => {
      if (
        state.themePreset !== prev.themePreset
        || state.colorMode !== prev.colorMode
        || state.uiFontSizeId !== prev.uiFontSizeId
        || state.readableCodeFontSizeId !== prev.readableCodeFontSizeId
      ) {
        applyStoredAppearance()
      }
    })
    const systemModeQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleSystemModeChange = () => {
      if (useUserPreferencesStore.getState().colorMode === "system") {
        applyStoredAppearance()
      }
    }
    systemModeQuery.addEventListener("change", handleSystemModeChange)

    void bootstrapUserPreferences().then(applyStoredAppearance)
    void bootstrapRepoPreferences()
    void bootstrapWorkspaceUi()
    void bootstrapLogicalWorkspaceSelection()

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
    return () => {
      unsubscribeAppearance()
      systemModeQuery.removeEventListener("change", handleSystemModeChange)
    }
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

  return (
    <>
      <AppCommandActionsProvider value={appCommandActions}>
        <MacWindowControlsSafeArea />
        <UpdateRestartDialog />
        <SessionModelAvailabilityDialog />
        <RuntimeInputSyncGate />
        <InstrumentedRoutes>
          <Route path="/index.html" element={<Navigate to="/" replace />} />
          <Route path="/settings/cloud" element={<SettingsCloudRedirect />} />
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
          <Route element={<BootstrappedRoute />}>
            <Route element={<AuthRequiredGate />}>
              <Route path="/setup" element={<Navigate to="/" replace />} />
              <Route element={<UserPreferencesGate />}>
                <Route path={APP_ROUTES.home} element={<MainPage />} />
                <Route
                  path={LEGACY_APP_ROUTES.powers}
                  element={<Navigate to={APP_ROUTES.plugins} replace />}
                />
                <Route path={APP_ROUTES.plugins} element={<PluginsPage />} />
                <Route path={APP_ROUTES.automations} element={<AutomationsPage />} />
                <Route path="/automations/:automationId" element={<AutomationDetailPage />} />
                <Route path={APP_ROUTES.settings} element={<SettingsPage />} />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </InstrumentedRoutes>
        <RepoSetupModalHost />
        <ToastContainer />
        <TurnEndCelebration />
      </AppCommandActionsProvider>
    </>
  )
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

export default App
