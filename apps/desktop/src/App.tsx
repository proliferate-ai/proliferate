import { Suspense, lazy } from "react"
import { Navigate, Route } from "react-router-dom"
import { BootstrappedRoute, PublicOnlyRoute } from "@/components/auth/AuthGate"
import { UserPreferencesGate } from "@/components/app/UserPreferencesGate"
import { KeyboardShortcutsDialog } from "@/components/workspace/shell/sidebar/KeyboardShortcutsDialog"
import { ToastContainer } from "@/components/feedback/Toast"
import { UpdateRestartDialog } from "@/components/feedback/UpdateRestartDialog"
import { UpdateToastPresenter } from "@/components/feedback/UpdateToastPresenter"
import { Toaster } from "@proliferate/ui/kit/Sonner"
import { MacWindowControlsSafeArea } from "@/components/app/chrome/MacWindowControlsSafeArea"
import { useLocalWorktreeSettingsTarget } from "@/hooks/workspaces/facade/use-local-worktree-settings-target"
import { useWorktreeCleanupPolicySync } from "@/hooks/workspaces/lifecycle/use-worktree-cleanup-policy-sync"
import { RepoSetupModalHost } from "@/components/workspace/repo-setup/RepoSetupModalHost"
import { SupportModalHost } from "@/components/support/SupportModalHost"
import { AddRepoFlowHost } from "@/components/workspace/repo-setup/AddRepoFlowHost"
import { InstrumentedRoutes } from "@/lib/integrations/telemetry/sentry"
import { AuthenticatedAppHost } from "@/pages/AuthenticatedAppHost"
import { LoginPage } from "@/pages/LoginPage"
import { SettingsCloudRedirect } from "@/pages/SettingsCloudRedirect"
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store"
import { ShortcutRevealProvider } from "@/providers/ShortcutRevealProvider"

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

const WorkspaceStatusPlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("@/pages/WorkspaceStatusPlaygroundPage").then((m) => ({
        default: m.WorkspaceStatusPlaygroundPage,
      })),
    )
  : null

const AuthPlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("@/pages/AuthPlaygroundPage").then((m) => ({
        default: m.AuthPlaygroundPage,
      })),
    )
  : null

const AgentsPlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("@/pages/AgentsPlaygroundPage").then((m) => ({
        default: m.AgentsPlaygroundPage,
      })),
    )
  : null

const SubagentsUxPlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("@/pages/SubagentsUxPlaygroundPage").then((m) => ({
        default: m.SubagentsUxPlaygroundPage,
      })),
    )
  : null

// Thin product route/UI tree. Shared and Desktop lifecycle wiring lives above
// this component in `ProductLifecycleRoot`, which also owns the single
// `AppErrorBoundary` enclosing both the lifecycle hooks and this tree; `App`
// owns only the route tree, modal hosts, and toasts.
function App() {
  return (
      <ShortcutRevealProvider>
        <MacWindowControlsSafeArea />
        <UpdateRestartDialog />
        <WorktreeCleanupPolicySyncGate />
        <InstrumentedRoutes>
          <Route path="/index.html" element={<Navigate to="/" replace />} />
          <Route path="/settings/cloud" element={<SettingsCloudRedirect />} />
          <Route path="/settings/billing" element={<SettingsCloudRedirect />} />
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
          <Route element={<BootstrappedRoute />}>
            {/* BootstrappedRoute owns the auth-required gate: it shows the
                sign-in shell for anonymous users and only renders these
                routes once the workspace should be revealed. */}
            <Route path="/setup" element={<Navigate to="/" replace />} />
            <Route element={<UserPreferencesGate />}>
              <Route path="*" element={<AuthenticatedAppHost />} />
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
          {import.meta.env.DEV && WorkspaceStatusPlaygroundPage && (
            <Route
              path="/playground/workspace-status"
              element={
                <Suspense fallback={null}>
                  <WorkspaceStatusPlaygroundPage />
                </Suspense>
              }
            />
          )}
          {import.meta.env.DEV && AuthPlaygroundPage && (
            <Route
              path="/playground/auth"
              element={
                <Suspense fallback={null}>
                  <AuthPlaygroundPage />
                </Suspense>
              }
            />
          )}
          {import.meta.env.DEV && AgentsPlaygroundPage && (
            <Route
              path="/playground/agents"
              element={
                <Suspense fallback={null}>
                  <AgentsPlaygroundPage />
                </Suspense>
              }
            />
          )}
          {import.meta.env.DEV && SubagentsUxPlaygroundPage && (
            <Route
              path="/playground/subagents"
              element={
                <Suspense fallback={null}>
                  <SubagentsUxPlaygroundPage />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </InstrumentedRoutes>
        <RepoSetupModalHost />
        <AddRepoFlowHost />
        <SupportModalHost />
        {/* Legacy toast store container (non-update toasts) — kept until all
            toast call sites migrate to Sonner. */}
        <ToastContainer />
        {/* Kit Sonner toaster + update lifecycle toasts (UX spec §12). */}
        <Toaster />
        <UpdateToastPresenter />
        <KeyboardShortcutsDialog />
      </ShortcutRevealProvider>
  )
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
