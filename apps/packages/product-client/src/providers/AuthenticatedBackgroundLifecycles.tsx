import { useWorkspacePinIntentReconciliationLifecycle } from "#product/hooks/sessions/lifecycle/use-workspace-pin-intent-reconciliation"

/**
 * Session and local-runtime background work, mounted only while authenticated.
 *
 * These owners have no dispatchable work without a product session. Keeping
 * them behind the authenticated lazy boundary preserves their resident
 * lifetime while keeping session hydration and runtime reconciliation off the
 * /login first-load path.
 *
 * Deferred home-launch resumption (useHomeDeferredLaunchRunner) is NOT
 * mounted here even though it has the same shape: AuthenticatedLaunchLifecycles
 * already owns it, alongside the cloud-workspace poll loop that finalizes
 * those launches (PRO-230) — mounting it twice would double-invoke the hook.
 *
 * The session intent dispatcher is NOT mounted here either: draining a queued
 * prompt is local runtime work that an anonymous client must also be able to
 * do. It lives in SessionIntentDispatcherLifecycle, mounted on queued work.
 */
export function AuthenticatedBackgroundLifecycles() {
  useWorkspacePinIntentReconciliationLifecycle()
  return null
}
