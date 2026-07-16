import { Suspense, lazy } from "react"
import { Navigate, Route } from "react-router-dom"
import { BootstrappedRoute, PublicOnlyRoute } from "#product/components/auth/AuthGate"
import { UserPreferencesGate } from "#product/components/app/UserPreferencesGate"
import { KeyboardShortcutsDialog } from "#product/components/workspace/shell/sidebar/KeyboardShortcutsDialog"
import { ToastContainer } from "#product/components/feedback/Toast"
import { UpdateRestartDialog } from "#product/components/feedback/UpdateRestartDialog"
import { UpdateToastPresenter } from "#product/components/feedback/UpdateToastPresenter"
import { Toaster } from "@proliferate/ui/kit/Sonner"
import { MacWindowControlsSafeArea } from "#product/components/app/chrome/MacWindowControlsSafeArea"
import { useLocalWorktreeSettingsTarget } from "#product/hooks/workspaces/facade/use-local-worktree-settings-target"
import { useWorktreeCleanupPolicySync } from "#product/hooks/workspaces/lifecycle/use-worktree-cleanup-policy-sync"
import { RepoSetupModalHost } from "#product/components/workspace/repo-setup/RepoSetupModalHost"
import { SupportModalHost } from "#product/components/support/SupportModalHost"
import { AddRepoFlowHost } from "#product/components/workspace/repo-setup/AddRepoFlowHost"
import { CloudRepoActionDialogHost } from "#product/components/workspace/repo-setup/CloudRepoActionDialogHost"
import { LoginPage } from "#product/pages/LoginPage"
import { SettingsCloudRedirect } from "#product/pages/SettingsCloudRedirect"
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store"
import { ShortcutRevealProvider } from "#product/providers/ShortcutRevealProvider"
import type { ProductRoutesComponent } from "#product/ProductClient"

// The authenticated product root is internal and lazy-loaded through the
// compiled `#product/*` import, so the public shell (login/public routes) never
// eagerly pulls the authenticated-only chunks (editor/terminal/etc.).
const AuthenticatedProductClient = lazy(
  () => import("#product/app/AuthenticatedProductClient"),
)

// Dev-only playground. Lazy-loaded with a DEV guard so neither this file
// nor any of its fixtures / transitive deps land in production bundles.
const ChatPlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("#product/pages/ChatPlaygroundPage").then((m) => ({
        default: m.ChatPlaygroundPage,
      })),
    )
  : null

const UpdatePlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("#product/pages/UpdatePlaygroundPage").then((m) => ({
        default: m.UpdatePlaygroundPage,
      })),
    )
  : null

const WorkspaceStatusPlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("#product/pages/WorkspaceStatusPlaygroundPage").then((m) => ({
        default: m.WorkspaceStatusPlaygroundPage,
      })),
    )
  : null

const GitReviewPlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("#product/pages/GitReviewPlaygroundPage").then((m) => ({
        default: m.GitReviewPlaygroundPage,
      })),
    )
  : null

const AuthPlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("#product/pages/AuthPlaygroundPage").then((m) => ({
        default: m.AuthPlaygroundPage,
      })),
    )
  : null

const AgentsPlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("#product/pages/AgentsPlaygroundPage").then((m) => ({
        default: m.AgentsPlaygroundPage,
      })),
    )
  : null

const SubagentsUxPlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("#product/pages/SubagentsUxPlaygroundPage").then((m) => ({
        default: m.SubagentsUxPlaygroundPage,
      })),
    )
  : null

interface AppProps {
  // Host-supplied routes component (Desktop/Web pass their Sentry-instrumented
  // InstrumentedRoutes; the browser fixture passes plain React Router Routes).
  // ProductClient never imports Sentry.
  RoutesComponent: ProductRoutesComponent
}

// Thin product route/UI tree. Shared and Desktop lifecycle wiring lives above
// this component in `ProductLifecycleRoot`, which also owns the single
// `AppErrorBoundary` enclosing both the lifecycle hooks and this tree; `App`
// owns only the route tree, modal hosts, and toasts.
export function App({ RoutesComponent }: AppProps) {
  return (
      <ShortcutRevealProvider>
        <MacWindowControlsSafeArea />
        <UpdateRestartDialog />
        <WorktreeCleanupPolicySyncGate />
        <RoutesComponent>
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
              <Route
                path="*"
                element={
                  <Suspense fallback={null}>
                    <AuthenticatedProductClient />
                  </Suspense>
                }
              />
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
          {import.meta.env.DEV && GitReviewPlaygroundPage && (
            <Route
              path="/playground/git-review"
              element={
                <Suspense fallback={null}>
                  <GitReviewPlaygroundPage />
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
        </RoutesComponent>
        <RepoSetupModalHost />
        <AddRepoFlowHost />
        <CloudRepoActionDialogHost />
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
