import { useHomeDeferredLaunchRunner } from "#product/hooks/home/lifecycle/use-home-deferred-launch-runner"
import { recordBootDiagnosticOnce } from "#product/lib/infra/measurement/measurement-port"

/**
 * The session-resident launch lifecycles, mounted only once the viewer is
 * authenticated.
 *
 * These consume the client-owned launch registry: deferred Home launches and
 * the attempts they park. None of it can exist for a signed-out viewer, so the
 * lifecycle root mounts this behind `React.lazy` + the authenticated gate (the
 * same treatment `AuthRestartOfferRoot` gets). That keeps the whole
 * launch/session-creation graph — pending registry, attempt access, workspace
 * entry, session creation — out of the login first-load chunk, which has a
 * fail-closed JS budget (PRO-230).
 *
 * It stays a lifecycle-only component: it renders nothing, and it must be
 * mounted above the route tree so a launch survives the user navigating away
 * from the workspace that started it.
 */
export function AuthenticatedLaunchLifecycles(): null {
  recordBootDiagnosticOnce("app_runtime.render.before.use_home_deferred_launch_runner")
  useHomeDeferredLaunchRunner()
  recordBootDiagnosticOnce("app_runtime.render.after.use_home_deferred_launch_runner")
  return null
}
