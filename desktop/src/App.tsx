import { Suspense, lazy, useEffect } from "react"
import { Navigate, Route, useLocation } from "react-router-dom"
import { BootstrappedRoute, PublicOnlyRoute } from "@/components/auth/AuthGate"
import { AuthRequiredGate } from "@/components/auth/AuthRequiredGate"
import { OnboardingGate, OnboardingRoute } from "@/components/onboarding/OnboardingGate"
import { ToastContainer } from "@/components/feedback/Toast"
import { TurnEndCelebration } from "@/components/feedback/TurnEndCelebration"
import { UpdateRestartDialog } from "@/components/feedback/UpdateRestartDialog"
import { applyThemePreference, initializeTheme } from "@/config/theme"
import { useExportRunningAgentCount } from "@/hooks/app/use-export-running-agent-count"
import { useAppShortcuts } from "@/hooks/app/use-app-shortcuts"
import { useAuthBootstrap } from "@/hooks/auth/use-auth-bootstrap"
import { useAgentAutoReconcile } from "@/hooks/agents/use-agent-auto-reconcile"
import { useRuntimeInputSyncRuntime } from "@/hooks/cloud/use-runtime-input-sync-runtime"
import { useConnectorSyncRetryDaemon } from "@/hooks/mcp/use-connector-sync-retry-daemon"
import { useOnboardingFinalizer } from "@/hooks/onboarding/use-onboarding-finalizer"
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
import { LoginPage } from "@/pages/LoginPage"
import { MainPage } from "@/pages/MainPage"
import { OnboardingPage } from "@/pages/OnboardingPage"
import { PowersPage } from "@/pages/PowersPage"
import { SettingsPage } from "@/pages/SettingsPage"
import { useAuthStore } from "@/stores/auth/auth-store"
import {
  bootstrapUserPreferences,
  useUserPreferencesStore,
} from "@/stores/preferences/user-preferences-store"
import { bootstrapRepoPreferences } from "@/stores/preferences/repo-preferences-store"
import { bootstrapWorkspaceUi } from "@/stores/preferences/workspace-ui-store"
import { bootstrapLogicalWorkspaceSelection } from "@/stores/workspaces/logical-workspace-store"

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
  useExportRunningAgentCount()
  useShortcutDispatcher()
  useAppShortcuts()
  useTurnEndSound()
  useAgentAutoReconcile()
  useConnectorSyncRetryDaemon()
  useOnboardingFinalizer()

  useEffect(() => {
    logStartupDebug("app.bootstrap.start")
    initializeTheme()
    const applyStoredTheme = () => {
      const { themePreset, colorMode } = useUserPreferencesStore.getState()
      applyThemePreference(themePreset, colorMode)
    }
    applyStoredTheme()

    const unsubscribeTheme = useUserPreferencesStore.subscribe((state, prev) => {
      if (state.themePreset !== prev.themePreset || state.colorMode !== prev.colorMode) {
        applyStoredTheme()
      }
    })
    const systemModeQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleSystemModeChange = () => {
      if (useUserPreferencesStore.getState().colorMode === "system") {
        applyStoredTheme()
      }
    }
    systemModeQuery.addEventListener("change", handleSystemModeChange)

    void bootstrapUserPreferences().then(applyStoredTheme)
    void bootstrapRepoPreferences()
    void bootstrapWorkspaceUi()
    void bootstrapLogicalWorkspaceSelection()

    const authBootstrapStartedAt = startStartupTimer()
    logStartupDebug("app.auth_bootstrap.start")
    void bootstrapAuth().finally(() => {
      logStartupDebug("app.auth_bootstrap.completed", {
        elapsedMs: elapsedStartupMs(authBootstrapStartedAt),
        authStatus: useAuthStore.getState().status,
      })
    })
    return () => {
      unsubscribeTheme()
      systemModeQuery.removeEventListener("change", handleSystemModeChange)
    }
  }, [bootstrapAuth])

  useEffect(() => {
    if (authStatus !== "bootstrapping") {
      const runtimeBootstrapStartedAt = startStartupTimer()
      logStartupDebug("app.runtime_bootstrap.start", { authStatus })
      void bootstrapHarnessRuntime().finally(() => {
        logStartupDebug("app.runtime_bootstrap.completed", {
          elapsedMs: elapsedStartupMs(runtimeBootstrapStartedAt),
          authStatus,
        })
      })
    }
  }, [authStatus])

  return (
    <>
      <UpdateRestartDialog />
      <RuntimeInputSyncGate />
      <InstrumentedRoutes>
        <Route path="/settings/cloud" element={<SettingsCloudRedirect />} />
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>
        <Route element={<BootstrappedRoute />}>
          <Route element={<AuthRequiredGate />}>
            <Route element={<OnboardingRoute />}>
              <Route path="/setup" element={<OnboardingPage />} />
            </Route>
            <Route element={<OnboardingGate />}>
              <Route path="/" element={<MainPage />} />
              <Route path="/powers" element={<PowersPage />} />
              <Route path="/settings" element={<SettingsPage />} />
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
      </InstrumentedRoutes>
      <RepoSetupModalHost />
      <ToastContainer />
      <TurnEndCelebration />
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
