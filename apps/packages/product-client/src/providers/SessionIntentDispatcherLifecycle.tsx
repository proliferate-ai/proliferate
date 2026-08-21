import { useSessionIntentDispatcher } from "#product/hooks/sessions/lifecycle/use-session-intent-dispatcher"
import { recordBootDiagnosticOnce } from "#product/lib/infra/measurement/measurement-port"

/**
 * The session intent dispatcher, mounted on queued work rather than on identity.
 *
 * Draining a session intent is local runtime work: a prompt queued against a
 * local session is delivered to the local runtime, and nothing on that path
 * consults the product session. Mounting the dispatcher inside
 * AuthenticatedBackgroundLifecycles therefore gated a local capability on a
 * control-plane fact. An anonymous or local-only client could still create a
 * session (session creation talks to the runtime directly), so its prompts were
 * accepted into the outbox and then never dispatched: the composer sat on
 * "Thinking" with no error, because nothing was there to drain the queue.
 *
 * The lazy boundary that keeps this graph off the /login first-load path is
 * preserved by the mount condition rather than by the auth status: a login
 * first load has no queued intents, so the chunk still is not requested there.
 */
export function SessionIntentDispatcherLifecycle() {
  recordBootDiagnosticOnce("app_runtime.render.before.use_session_intent_dispatcher")
  useSessionIntentDispatcher()
  recordBootDiagnosticOnce("app_runtime.render.after.use_session_intent_dispatcher")
  return null
}
