import { useLocalAutomationExecutor } from "#product/hooks/automations/lifecycle/use-local-automation-executor"
import { useHomeDeferredLaunchRunner } from "#product/hooks/home/lifecycle/use-home-deferred-launch-runner"
import { recordBootDiagnosticOnce } from "#product/lib/infra/measurement/measurement-port"

/**
 * Local automation execution and deferred home-launch resumption, mounted
 * only while authenticated.
 *
 * Both hooks already no-op when signed out (there is no automation to run
 * and no deferred launch to resume without a session), so gating the owner
 * behind the same auth check that already governs their behavior is a
 * bundling-only change. It lets the pair be lazy-loaded, which keeps the
 * local-automation and deferred-launch modules off the /login first-load
 * path (login runtime JS budget).
 */
export function AuthenticatedBackgroundLifecycles() {
  recordBootDiagnosticOnce("app_runtime.render.before.use_local_automation_executor")
  useLocalAutomationExecutor()
  recordBootDiagnosticOnce("app_runtime.render.after.use_local_automation_executor")
  recordBootDiagnosticOnce("app_runtime.render.before.use_home_deferred_launch_runner")
  useHomeDeferredLaunchRunner()
  recordBootDiagnosticOnce("app_runtime.render.after.use_home_deferred_launch_runner")
  return null
}
