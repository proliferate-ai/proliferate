import { useEffect } from "react"
import { Route } from "react-router-dom"
import { BootstrappedRoute, PublicOnlyRoute } from "@/components/auth/AuthGate"
import { AuthRequiredGate } from "@/components/auth/AuthRequiredGate"
import { SetupGate, SetupRoute } from "@/components/setup/SetupGate"
import { ToastContainer } from "@/components/feedback/Toast"
import { TurnEndCelebration } from "@/components/feedback/TurnEndCelebration"
import { UpdateRestartDialog } from "@/components/feedback/UpdateRestartDialog"
import { applyThemePreference, initializeTheme } from "@/config/theme"
import { useExportRunningAgentCount } from "@/hooks/app/use-export-running-agent-count"
import { useAppShortcuts } from "@/hooks/app/use-app-shortcuts"
import { useAuthBootstrap } from "@/hooks/auth/use-auth-bootstrap"
import { useAgentAutoReconcile } from "@/hooks/agents/use-agent-auto-reconcile"
import { useShortcutDispatcher } from "@/hooks/shortcuts/use-shortcut-dispatcher"
import { useTurnEndSound } from "@/hooks/sessions/use-turn-end-sound"
import { bootstrapHarnessRuntime } from "@/lib/integrations/anyharness/runtime-bootstrap"
import { AppErrorBoundary } from "@/components/ui/AppErrorBoundary"
import { RepoSetupModalHost } from "@/components/workspace/repo-setup/RepoSetupModalHost"
import { InstrumentedRoutes } from "@/lib/integrations/telemetry/sentry"
import { LoginPage } from "@/pages/LoginPage"
import { MainPage } from "@/pages/MainPage"
import { SettingsPage } from "@/pages/SettingsPage"
import { SetupPage } from "@/pages/SetupPage"
import { useAuthStore } from "@/stores/auth/auth-store"
import {
  bootstrapUserPreferences,
  useUserPreferencesStore,
} from "@/stores/preferences/user-preferences-store"
import { bootstrapRepoPreferences } from "@/stores/preferences/repo-preferences-store"
import { bootstrapWorkspaceUi } from "@/stores/preferences/workspace-ui-store"

function App() {
  const bootstrapAuth = useAuthBootstrap()
  const authStatus = useAuthStore((s) => s.status)
  useExportRunningAgentCount()
  useShortcutDispatcher()
  useAppShortcuts()
  useTurnEndSound()
  useAgentAutoReconcile()

  useEffect(() => {
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
    void bootstrapAuth()
    return () => {
      unsubscribeTheme()
      systemModeQuery.removeEventListener("change", handleSystemModeChange)
    }
  }, [bootstrapAuth])

  useEffect(() => {
    if (authStatus !== "bootstrapping") {
      void bootstrapHarnessRuntime()
    }
  }, [authStatus])

  return (
    <>
      <UpdateRestartDialog />
      <AppErrorBoundary>
        <InstrumentedRoutes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
          <Route element={<BootstrappedRoute />}>
            <Route element={<AuthRequiredGate />}>
              <Route element={<SetupRoute />}>
                <Route path="/setup" element={<SetupPage />} />
              </Route>
              <Route element={<SetupGate />}>
                <Route path="/" element={<MainPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Route>
          </Route>
        </InstrumentedRoutes>
        <RepoSetupModalHost />
      </AppErrorBoundary>
      <ToastContainer />
      <TurnEndCelebration />
    </>
  )
}

export default App
