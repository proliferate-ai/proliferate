// @refresh reset
// This hook-dense application root must remount after an HMR update so React
// never reuses lifecycle hook cells from the module's previous topology.
import { Suspense, lazy, useEffect, useRef, type ReactNode } from "react"
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider"

import { useConnectivityListeners } from "#product/hooks/app/lifecycle/use-connectivity-listeners"
import { useDebugSessionActivity } from "#product/hooks/app/lifecycle/use-debug-session-activity"
import { useDevDesktopHandoff } from "#product/hooks/app/lifecycle/use-dev-desktop-handoff"
import { useProductEntryRouting } from "#product/hooks/app/lifecycle/use-product-entry-routing"
import { useOrganizationJoinAuthLaunch } from "#product/hooks/organizations/lifecycle/use-organization-join-auth-launch"
import { useAppShortcuts } from "#product/hooks/app/lifecycle/use-app-shortcuts"
import { useAppCommandActions } from "#product/hooks/app/workflows/use-app-command-actions"
import { useAgentAutoReconcile } from "#product/hooks/agents/lifecycle/use-agent-auto-reconcile"
import { useFirstRunAuthAdoption } from "#product/hooks/agents/lifecycle/use-first-run-auth-adoption"
import { useLocalAuthStateSync } from "#product/hooks/agents/lifecycle/use-local-auth-state-sync"
import { useAppearancePreferenceLifecycle } from "#product/hooks/preferences/lifecycle/use-appearance-preference-lifecycle"
import { useRepoPreferencesLifecycle } from "#product/hooks/preferences/lifecycle/use-repo-preferences-lifecycle"
import { useUserPreferencesLifecycle } from "#product/hooks/preferences/lifecycle/use-user-preferences-lifecycle"
import { useWorkspaceUiLifecycle } from "#product/hooks/preferences/lifecycle/use-workspace-ui-lifecycle"
import { useProductStoragePersistenceLifecycle } from "#product/hooks/persistence/lifecycle/use-product-storage-persistence-lifecycle"
import { useSessionSelectionLifecycle } from "#product/hooks/sessions/lifecycle/use-session-selection-lifecycle"
import { useShortcutDispatcher } from "#product/hooks/shortcuts/lifecycle/use-shortcut-dispatcher"
import { useCrashRecoverySupportAction } from "#product/hooks/support/workflows/use-crash-recovery-support-action"
import { useSupportReportRetentionLifecycle } from "#product/hooks/support/lifecycle/use-support-report-retention"
import { useTurnEndSound } from "#product/hooks/sessions/lifecycle/use-turn-end-sound"
import { useTurnEndDiagnostics } from "#product/hooks/sessions/lifecycle/use-turn-end-diagnostics"
import { useWorkspaceGitStatusPersistence } from "#product/hooks/workspaces/lifecycle/use-workspace-git-status-persistence"
import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
} from "#product/lib/infra/measurement/measurement-port"
import {
  recordBootDiagnostic,
  recordBootDiagnosticOnce,
} from "#product/lib/infra/measurement/measurement-port"
import { AppCommandActionsProvider } from "#product/providers/AppCommandActionsProvider"
import { DesktopProductLifecycleRoot } from "#product/providers/DesktopProductLifecycleRoot"
import { AppErrorBoundary } from "#product/components/app/AppErrorBoundary"
import { useProductAuthStatus } from "#product/hooks/auth/facade/use-product-auth"
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store"
import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port"

// The restart offer can only exist for an authenticated user (it follows an
// acked auth switch), so the modal + session-restart machinery is lazy-loaded
// and mounted only once authenticated — the login first-load chunk parses zero
// bytes of restart-modal code (login runtime JS budget).
const AuthRestartOfferRoot = lazy(() =>
  import("#product/components/agents/AuthRestartOfferRoot").then((m) => ({
    default: m.AuthRestartOfferRoot,
  })),
)

// The support-report upload owner needs a Cloud session on both ends (the modal
// cannot open without one, and every drain step is an authenticated call), so it
// is authenticated-only + lazy for the same reason: the login shell fetches zero
// bytes of the queue, artifact-verification, and upload modules.
const SupportReportQueueRoot = lazy(() =>
  import("#product/providers/SupportReportQueueRoot").then((m) => ({
    default: m.SupportReportQueueRoot,
  })),
)

// The launch lifecycles consume the client-owned launch registry, which only a
// signed-in viewer can have. Same treatment as the restart offer: lazy +
// authenticated-only, so the login first-load chunk parses zero bytes of the
// launch / session-creation graph (login runtime JS budget, PRO-230).
const AuthenticatedLaunchLifecycles = lazy(() =>
  import("#product/providers/AuthenticatedLaunchLifecycles").then((m) => ({
    default: m.AuthenticatedLaunchLifecycles,
  })),
)

// Session dispatch and runtime-to-client reconciliation both require an
// authenticated product session, so their owners are authenticated-only +
// lazy: the login shell never fetches or parses those runtime graphs (login
// runtime JS budget).
// Deferred home-launch resumption is owned by AuthenticatedLaunchLifecycles
// above (it shares that component's launch-registry lifetime), so it is not
// duplicated here.
const AuthenticatedBackgroundLifecycles = lazy(() =>
  import("#product/providers/AuthenticatedBackgroundLifecycles").then((m) => ({
    default: m.AuthenticatedBackgroundLifecycles,
  })),
)

const SessionIntentDispatcherLifecycle = lazy(() =>
  import("#product/providers/SessionIntentDispatcherLifecycle").then((m) => ({
    default: m.SessionIntentDispatcherLifecycle,
  })),
)

// The workspace-switch shortcuts (Cmd+1..9, Cmd+Opt+Arrow) were the only
// unconditional (pre-auth) callers of useSidebarShortcutTargets and the
// held-key traversal cursor controller/store. Same treatment as the owners
// above: authenticated-only + lazy, so the login first-load chunk never
// parses the sidebar-shortcut-target projection or the cursor machinery
// (login runtime JS budget). The shortcuts were already no-ops signed out (no
// workspace to select). This does NOT gate useWorkspaceNavigationWorkflow's
// workspace-selection / agent-catalog / session-creation graph, which remains
// reachable from /login via useAppNavigationCommandActions and
// useAppNewWorkspaceCommandActions (see use-app-shortcuts.ts).
const AuthenticatedWorkspaceSwitchShortcuts = lazy(() =>
  import("#product/providers/AuthenticatedWorkspaceSwitchShortcuts").then((m) => ({
    default: m.AuthenticatedWorkspaceSwitchShortcuts,
  })),
)

const APP_RUNTIME_RENDER_MILESTONES = new Set([1, 2, 3, 5, 10, 25, 50, 100, 250])

let appRuntimeRenderCount = 0

function recordAppRendererEvent(
  message: string,
  elapsedMs?: number,
): void {
  recordBootDiagnostic(
    `app_bootstrap.${message}`,
    elapsedMs === undefined ? undefined : { elapsedMs },
  )
  recordRendererDiagnostic({
    name: `renderer.app_bootstrap.${message}`,
    severity: "info",
    kind: "milestone",
    privacy: "operational",
    fields: elapsedMs === undefined
      ? undefined
      : { elapsed_ms: diagnosticField(elapsedMs, "operational") },
  })
}

/**
 * Product-owned lifecycle root. Encloses the shared lifecycle hooks in the
 * single `AppErrorBoundary` so a render-phase throw in any lifecycle is
 * contained — exactly as it was when these hooks lived inside `App`'s boundary,
 * before the root split hoisted them above `App`. The boundary must sit above
 * the component that runs the hooks (a React boundary only catches its
 * descendants), so the hooks live in the inner `ProductLifecycles` and the same
 * boundary also covers the product route/UI tree passed as `children`.
 */
export function ProductLifecycleRoot({ children }: { children: ReactNode }) {
  const productHost = useProductHost()
  const diagnostics = productHost.desktop?.diagnostics ?? null
  const contactSupport = useCrashRecoverySupportAction()
  let clientReleaseId: string | null = null
  try {
    clientReleaseId = productHost.telemetry.getSupportContext().clientReleaseId
  } catch {
    // Recovery identity is diagnostic-only. A broken accessor must not prevent
    // the boundary itself from mounting.
  }
  return (
    <AppErrorBoundary
      onRenderError={diagnostics
        ? (report) => diagnostics.reportRenderError(report)
        : undefined}
      clientReleaseId={clientReleaseId}
      onCopyDetails={(details) => productHost.clipboard.writeText(details)}
      onContactSupport={contactSupport ?? undefined}
    >
      <ProductLifecycles>{children}</ProductLifecycles>
    </AppErrorBoundary>
  )
}

/**
 * Mounts the shared product lifecycle hooks (in the exact order and
 * boot-diagnostic bracketing the app has always used), drives the auth restore
 * effect, and mounts the capability-gated `DesktopProductLifecycleRoot` (which
 * itself renders nothing on a non-Desktop host). It renders the product
 * route/UI tree (`children`) beneath the `AppCommandActionsProvider` it owns.
 */
function ProductLifecycles({ children }: { children: ReactNode }) {
  appRuntimeRenderCount += 1
  if (APP_RUNTIME_RENDER_MILESTONES.has(appRuntimeRenderCount)) {
    recordBootDiagnostic("app_runtime.render.pass", { count: appRuntimeRenderCount })
  }
  recordBootDiagnosticOnce("app_runtime.render.before.use_auth_bootstrap")
  const productHost = useProductHost()
  const bootstrapAuth = productHost.auth.restoreSession
  recordBootDiagnosticOnce("app_runtime.render.after.use_auth_bootstrap")
  recordBootDiagnosticOnce("app_runtime.render.before.auth_status")
  const authStatus = useProductAuthStatus()
  // Draining the session intent outbox is local runtime work, not a
  // control-plane feature, so it cannot be gated on the product session: an
  // anonymous or local-only client creates sessions against the local runtime
  // fine, and gating the dispatcher on `authenticated` left its prompts queued
  // forever behind a composer that just said "Thinking". Mount on the queued
  // work itself, which also keeps the graph off the /login first-load path the
  // lazy boundary exists to protect — a login first load has no intents.
  const hasSessionIntents = useSessionIntentStore(
    (state) => Object.keys(state.entriesById).length > 0,
  )
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
  useTurnEndDiagnostics()
  recordBootDiagnosticOnce("app_runtime.render.before.use_agent_auto_reconcile")
  useAgentAutoReconcile()
  recordBootDiagnosticOnce("app_runtime.render.after.use_agent_auto_reconcile")
  recordBootDiagnosticOnce("app_runtime.render.before.use_first_run_auth_adoption")
  useFirstRunAuthAdoption()
  recordBootDiagnosticOnce("app_runtime.render.after.use_first_run_auth_adoption")
  recordBootDiagnosticOnce("app_runtime.render.before.use_local_auth_state_sync")
  useLocalAuthStateSync()
  recordBootDiagnosticOnce("app_runtime.render.after.use_local_auth_state_sync")
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
  recordBootDiagnosticOnce("app_runtime.render.before.use_session_selection_lifecycle")
  useSessionSelectionLifecycle()
  recordBootDiagnosticOnce("app_runtime.render.after.use_session_selection_lifecycle")
  recordBootDiagnosticOnce("app_runtime.render.before.use_product_storage_persistence_lifecycle")
  useProductStoragePersistenceLifecycle()
  recordBootDiagnosticOnce("app_runtime.render.after.use_product_storage_persistence_lifecycle")
  // Deliberately above the auth gate. The queue owner below drains and needs a
  // Cloud session; retention does not, and the account that never signs in
  // again is exactly the one whose queue document and staged report bytes
  // would otherwise never be reaped.
  recordBootDiagnosticOnce("app_runtime.render.before.use_support_report_retention_lifecycle")
  useSupportReportRetentionLifecycle()
  recordBootDiagnosticOnce("app_runtime.render.after.use_support_report_retention_lifecycle")

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
        authStatus: authStatusRef.current,
      })
    })
  }, [bootstrapAuth])

  recordBootDiagnosticOnce("app_runtime.render.before_return", { authStatus })

  return (
    <AppCommandActionsProvider value={appCommandActions}>
      <DesktopProductLifecycleRoot />
      {/* Restart offer after an acked auth switch (agent-auth.md, Proof C6).
          Authenticated-only + lazy: the login shell never fetches or parses
          the restart-modal chunk. */}
      {authStatus === "authenticated" && (
        <Suspense fallback={null}>
          <AuthRestartOfferRoot />
        </Suspense>
      )}
      {authStatus === "authenticated" && (
        <Suspense fallback={null}>
          <SupportReportQueueRoot />
        </Suspense>
      )}
      {/* Launch lifecycles: resident above the route tree so a launch survives
          navigating away from the workspace that started it, but authenticated-
          only + lazy so the login first-load chunk never pulls the launch
          registry / session-creation graph (PRO-230). */}
      {authStatus === "authenticated" && (
        <Suspense fallback={null}>
          <AuthenticatedLaunchLifecycles />
        </Suspense>
      )}
      {authStatus === "authenticated" && (
        <Suspense fallback={null}>
          <AuthenticatedBackgroundLifecycles />
        </Suspense>
      )}
      {(authStatus === "authenticated" || hasSessionIntents) && (
        <Suspense fallback={null}>
          <SessionIntentDispatcherLifecycle />
        </Suspense>
      )}
      {authStatus === "authenticated" && (
        <Suspense fallback={null}>
          <AuthenticatedWorkspaceSwitchShortcuts />
        </Suspense>
      )}
      {children}
    </AppCommandActionsProvider>
  )
}
