import { useHomeDeferredLaunchRunner } from "#product/hooks/home/lifecycle/use-home-deferred-launch-runner"
import { useCloudWorkspacePolling } from "#product/hooks/workspaces/lifecycle/use-cloud-workspace-polling"
import { recordBootDiagnosticOnce } from "#product/lib/infra/measurement/measurement-port"

/**
 * The session-resident launch lifecycles, mounted only once the viewer is
 * authenticated.
 *
 * These consume the client-owned launch registry: deferred Home launches, the
 * attempts they park, and the registry-wide cloud poll loop that finalizes
 * them. None of it can exist for a signed-out viewer, so the lifecycle root
 * mounts this behind `React.lazy` + the authenticated gate (the same treatment
 * `AuthRestartOfferRoot` gets). That keeps the whole launch/session-creation
 * graph — pending registry, attempt access, workspace entry, session creation,
 * cloud polling — out of the login first-load chunk, which has a fail-closed
 * JS budget (PRO-230).
 *
 * It stays a lifecycle-only component: it renders nothing, and it must be
 * mounted above the route tree so a launch survives the user navigating away
 * from the workspace that started it.
 */
export function AuthenticatedLaunchLifecycles(): null {
  recordBootDiagnosticOnce("app_runtime.render.before.use_cloud_workspace_polling")
  // Resident for the whole session, beside the runner that consumes what it
  // finalizes. Inside the workspace shell it would stop the moment the user
  // sits on Home or /workflows, which nulls both selection ids and unmounts the
  // shell, leaving every parked cloud attempt unpolled (PRO-230).
  useCloudWorkspacePolling()
  recordBootDiagnosticOnce("app_runtime.render.after.use_cloud_workspace_polling")
  recordBootDiagnosticOnce("app_runtime.render.before.use_home_deferred_launch_runner")
  useHomeDeferredLaunchRunner()
  recordBootDiagnosticOnce("app_runtime.render.after.use_home_deferred_launch_runner")
  return null
}
