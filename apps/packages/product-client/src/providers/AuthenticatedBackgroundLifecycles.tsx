import { useLocalAutomationExecutor } from "#product/hooks/automations/lifecycle/use-local-automation-executor"
import { recordBootDiagnosticOnce } from "#product/lib/infra/measurement/measurement-port"

/**
 * Local automation execution, mounted only while authenticated.
 *
 * The hook already no-ops when signed out (there is no automation to run
 * without a session), so gating the owner behind the same auth check that
 * already governs its behavior is a bundling-only change. It lets the owner
 * be lazy-loaded, which keeps the local-automation module off the /login
 * first-load path (login runtime JS budget).
 *
 * Deferred home-launch resumption (useHomeDeferredLaunchRunner) is NOT
 * mounted here even though it has the same shape: AuthenticatedLaunchLifecycles
 * already owns it, alongside the cloud-workspace poll loop that finalizes
 * those launches (PRO-230) — mounting it twice would double-invoke the hook.
 */
export function AuthenticatedBackgroundLifecycles() {
  recordBootDiagnosticOnce("app_runtime.render.before.use_local_automation_executor")
  useLocalAutomationExecutor()
  recordBootDiagnosticOnce("app_runtime.render.after.use_local_automation_executor")
  return null
}
