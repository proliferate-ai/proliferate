const telemetryHandledErrors = new WeakSet<Error>();

export function markTelemetryHandled(error: Error): Error {
  telemetryHandledErrors.add(error);
  return error;
}

export function isTelemetryHandled(error: unknown): boolean {
  return error instanceof Error && telemetryHandledErrors.has(error);
}

const loginNotAttemptedErrors = new WeakSet<Error>();

/**
 * Mark a login rejection that was refused before any auth transport ran — an
 * unsupported request (Desktop cannot start Apple/Google/GitHub-link login) or
 * an unresolved precondition (a workspace slug with no enabled SSO). The
 * product audit wrapper re-throws these without emitting an `auth_sign_in_failed`
 * event, matching the prior below-host emitter, which only fired once an
 * orchestration flow actually attempted the login. This is a disposition tag,
 * not a telemetry emission: it carries no vendor coupling.
 */
export function markLoginNotAttempted(error: Error): Error {
  loginNotAttemptedErrors.add(error);
  return error;
}

export function isLoginNotAttempted(error: unknown): boolean {
  return error instanceof Error && loginNotAttemptedErrors.has(error);
}
