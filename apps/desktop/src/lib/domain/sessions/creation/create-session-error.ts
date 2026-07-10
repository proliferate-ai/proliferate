import { AnyHarnessError } from "@anyharness/sdk";

const UNSUPPORTED_SESSION_MODEL_CODE = "SESSION_MODEL_UNSUPPORTED";
const UNSUPPORTED_SESSION_MODE_CODE = "SESSION_MODE_UNSUPPORTED";
// Distinct from UNSUPPORTED: the model exists but is gated behind auth
// contexts that are not active (decisions ledger 16). The fix is to satisfy
// one of the required contexts (sign in / add a key / enroll the gateway),
// not to update the target.
const GATED_SESSION_MODEL_CODE = "SESSION_MODEL_GATED";

export function formatSessionCreateFailureMessage(error: unknown): string {
  const unsupportedMessage = unsupportedSessionSelectionMessage(error);
  if (unsupportedMessage) {
    return unsupportedMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

export function formatSessionCreateToastMessage(
  error: unknown,
  fallbackPrefix: string,
): string {
  const unsupportedMessage = unsupportedSessionSelectionMessage(error)
    ?? unsupportedSessionSelectionMessage(errorCause(error));
  if (unsupportedMessage) {
    return unsupportedMessage;
  }
  return `${fallbackPrefix}: ${formatSessionCreateFailureMessage(error)}`;
}

export function toSessionCreateFailureDisplayError(error: unknown): unknown {
  if (!isUnsupportedSessionSelectionError(error)) {
    return error;
  }
  const displayError = new Error(formatSessionCreateFailureMessage(error));
  (displayError as Error & { cause?: unknown }).cause = error;
  return displayError;
}

function unsupportedSessionSelectionMessage(error: unknown): string | null {
  if (!(error instanceof AnyHarnessError)) {
    return null;
  }
  if (error.problem.code === GATED_SESSION_MODEL_CODE) {
    return gatedSessionModelMessage(error);
  }
  if (error.problem.code === UNSUPPORTED_SESSION_MODEL_CODE) {
    return "This target does not support the selected model yet. Update AnyHarness on the target or choose another model.";
  }
  if (error.problem.code === UNSUPPORTED_SESSION_MODE_CODE) {
    return "This target does not support the selected session mode yet. Update AnyHarness on the target or choose another mode.";
  }
  return null;
}

function gatedSessionModelMessage(error: AnyHarnessError): string {
  const contexts = requiredContexts(error);
  if (contexts.length > 0) {
    return `This model is locked. Unlock it by signing in with or adding credentials for: ${contexts.join(", ")}.`;
  }
  return "This model is locked behind credentials this workspace does not have yet. Sign in, add an API key, or enable the gateway, then try again.";
}

function requiredContexts(error: AnyHarnessError): string[] {
  const value = (error.problem as { requiredContexts?: unknown }).requiredContexts;
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isUnsupportedSessionSelectionError(error: unknown): boolean {
  return error instanceof AnyHarnessError
    && (
      error.problem.code === UNSUPPORTED_SESSION_MODEL_CODE
      || error.problem.code === UNSUPPORTED_SESSION_MODE_CODE
      || error.problem.code === GATED_SESSION_MODEL_CODE
    );
}

function errorCause(error: unknown): unknown {
  return error instanceof Error
    ? (error as Error & { cause?: unknown }).cause
    : undefined;
}
