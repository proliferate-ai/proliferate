import { Suspense, lazy } from "react"
import { Navigate, Route } from "react-router-dom"
import { BootstrappedRoute, PublicOnlyRoute } from "#product/components/auth/AuthGate"
import { UserPreferencesGate } from "#product/components/app/UserPreferencesGate"
import { ToastHost } from "#product/primitives/patterns/toast/ToastHost"
import { ProliferateLivingMark } from "#product/components/brand/ProliferateLivingMark"
import { LoadingBoundary } from "#product/primitives/LoadingBoundary"
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider"
import { MacWindowControlsSafeArea } from "#product/components/app/chrome/MacWindowControlsSafeArea"
import { SupportModalHost } from "#product/components/support/SupportModalHost"
import { LoginPage } from "#product/pages/LoginPage"
import { SettingsCloudRedirect } from "#product/pages/SettingsCloudRedirect"
import { ShortcutRevealProvider } from "#product/providers/ShortcutRevealProvider"
import type { ProductRoutesComponent } from "#product/ProductClient"

// The authenticated product root is internal and lazy-loaded through the
// compiled `#product/*` import, so the public shell (login/public routes) never
// eagerly pulls the authenticated-only chunks (editor/terminal/etc.).
const AuthenticatedProductClient = lazy(
  () => import("#product/app/AuthenticatedProductClient"),
)

// Desktop-only: the app-update flow (restart dialog, phase toasts, automatic
// download). Lazy so the public shell — and /login, which has a fail-closed
// first-load JS budget — never pulls the updater state machine.
// Lazy like DesktopUpdateSurface: the gate only ever renders for an
// authenticated desktop, so its query hooks must not ride the /login chunk
// (login first-load budget).
const MinDesktopVersionGate = lazy(() =>
  import("#product/components/auth/MinDesktopVersionGate").then((m) => ({
    default: m.MinDesktopVersionGate,
  })),
)

const DesktopUpdateSurface = lazy(() =>
  import("#product/components/feedback/DesktopUpdateSurface").then((m) => ({
    default: m.DesktopUpdateSurface,
  })),
)

// Dev-only playground. Lazy-loaded with a DEV guard so neither this file
// nor any of its fixtures / transitive deps land in production bundles.
const PlaygroundIndexPage = import.meta.env.DEV
  ? lazy(() =>
      import("#product/pages/PlaygroundIndexPage").then((m) => ({
        default: m.PlaygroundIndexPage,
      })),
    )
  : null

const PlaygroundLibraryPage = import.meta.env.DEV
  ? lazy(() =>
      import("#product/pages/PlaygroundLibraryPage").then((m) => ({
        default: m.PlaygroundLibraryPage,
      })),
    )
  : null

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

const CrashRecoveryPlaygroundPage = import.meta.env.DEV
  ? lazy(() =>
      import("#product/pages/CrashRecoveryPlaygroundPage").then((m) => ({
        default: m.CrashRecoveryPlaygroundPage,
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
// owns only the route tree, public feedback hosts, and toasts. Repository and
// workspace hosts live behind the lazy authenticated product boundary.
export function App({ RoutesComponent }: AppProps) {
  return (
      <ShortcutRevealProvider>
        <MacWindowControlsSafeArea />
        <AppMinDesktopVersionGate />
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
                  // App-root cold-chunk boundary (UX Latency + Transitions ADR
                  // §4.3, Rung 3): the fallback is the Class A living mark,
                  // routed through `LoadingBoundary` in `state="pending"` so
                  // the show-delay window is honored. Known limitation: a
                  // `Suspense` fallback is unmounted the instant the chunk
                  // resolves, so `LoadingBoundary` never gets a `ready`
                  // transition here and its min-display hold cannot engage;
                  // a resolve inside the 200-500ms window can still flash the
                  // mark briefly. See PR #1926 for the residual-flicker note.
                  <Suspense
                    fallback={
                      <LoadingBoundary
                        state="pending"
                        diagnostics={{ flow: "app_root" }}
                        treatment={
                          <div className="flex min-h-screen items-center justify-center bg-background">
                            <ProliferateLivingMark />
                          </div>
                        }
                      />
                    }
                  >
                    <AuthenticatedProductClient />
                  </Suspense>
                }
              />
            </Route>
          </Route>
          {import.meta.env.DEV && PlaygroundIndexPage && (
            <Route
              path="/playground"
              element={
                <Suspense fallback={null}>
                  <PlaygroundIndexPage />
                </Suspense>
              }
            />
          )}
          {import.meta.env.DEV && PlaygroundLibraryPage && (
            <Route
              path="/playground/library"
              element={
                <Suspense fallback={null}>
                  <PlaygroundLibraryPage />
                </Suspense>
              }
            />
          )}
          {import.meta.env.DEV && ChatPlaygroundPage && (
            <Route
              path="/playground/chat"
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
          {import.meta.env.DEV && CrashRecoveryPlaygroundPage && (
            <Route
              path="/playground/crash-recovery"
              element={
                <Suspense fallback={null}>
                  <CrashRecoveryPlaygroundPage />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </RoutesComponent>
        <SupportModalHost />
        {/* The single toast mount. Every toast in the app goes through it, so
            the three weights, the visible cap and the details expansion are
            configured in exactly one place. */}
        <ToastHost />
        <AppUpdateSurface />
      </ShortcutRevealProvider>
  )
}

/**
 * The whole app-update surface — the restart dialog, the phase toasts, and the
 * automatic download — behind the one condition that makes any of it reachable:
 * a host that actually has an updater. On Web there is none, so the browser
 * never loads a state machine it cannot enter, and /login (which has a
 * fail-closed first-load JS budget) never pays for the desktop updater at all.
 */
function AppUpdateSurface() {
  const hasUpdater = Boolean(useProductHost().desktop?.updater)

  if (!hasUpdater) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <DesktopUpdateSurface />
    </Suspense>
  )
}

/**
 * Same desktop-only gate as `AppUpdateSurface`: the min-desktop-version block
 * screen only makes sense where there's an updater to jump into and a
 * connectable server to be behind on, so Web never pays for the query hooks.
 */
function AppMinDesktopVersionGate() {
  const host = useProductHost()
  const hasUpdater = Boolean(host.desktop?.updater)
  // Never cover the sign-in/connect surface: a signed-out user must always be
  // able to reach it and point the app at a different server, so a
  // misconfigured floor can only ever strand a session, not the app itself.
  const authenticated =
    host.auth.state.status === "authenticated" || !host.auth.authRequired

  if (!hasUpdater || !authenticated) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <MinDesktopVersionGate />
    </Suspense>
  )
}

