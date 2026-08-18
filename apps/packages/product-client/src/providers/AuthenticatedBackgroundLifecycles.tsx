import { useLocalAutomationExecutor } from "#product/hooks/automations/lifecycle/use-local-automation-executor"
import { useSessionIntentDispatcher } from "#product/hooks/sessions/lifecycle/use-session-intent-dispatcher"
import { useWorkspacePinIntentReconciliationLifecycle } from "#product/hooks/sessions/lifecycle/use-workspace-pin-intent-reconciliation"
import { recordBootDiagnosticOnce } from "#product/lib/infra/measurement/measurement-port"

/**
 * Session and local-runtime background work, mounted only while authenticated.
 *
 * These owners have no dispatchable work without a product session. Keeping
 * them behind the authenticated lazy boundary preserves their resident
 * lifetime while keeping session hydration, runtime reconciliation, and local
 * automation off the /login first-load path.
 *
 * Deferred home-launch resumption (useHomeDeferredLaunchRunner) is NOT
 * mounted here even though it has the same shape: AuthenticatedLaunchLifecycles
 * already owns it, alongside the cloud-workspace poll loop that finalizes
 * those launches (PRO-230) — mounting it twice would double-invoke the hook.
 */
export function AuthenticatedBackgroundLifecycles() {
  useWorkspacePinIntentReconciliationLifecycle()
  recordBootDiagnosticOnce("app_runtime.render.before.use_session_intent_dispatcher")
  useSessionIntentDispatcher()
  recordBootDiagnosticOnce("app_runtime.render.after.use_session_intent_dispatcher")
  recordBootDiagnosticOnce("app_runtime.render.before.use_local_automation_executor")
  useLocalAutomationExecutor()
  recordBootDiagnosticOnce("app_runtime.render.after.use_local_automation_executor")
  return null
}
