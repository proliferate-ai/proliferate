import { AnyHarnessError } from "@anyharness/sdk";

const UNSUPPORTED_SESSION_MODEL_CODE = "SESSION_MODEL_UNSUPPORTED";
const UNSUPPORTED_SESSION_MODE_CODE = "SESSION_MODE_UNSUPPORTED";
// Distinct from UNSUPPORTED: the model exists but is gated behind auth
// contexts that are not active. UNSUPPORTED means the requested model ID did
// not resolve. GATED carries the contexts that can unlock the known model.
const GATED_SESSION_MODEL_CODE = "SESSION_MODEL_GATED";
// The workspace's local checkout is gone from disk. Not toasted: the
// persistent missing-worktree composer panel owns this condition, so the
// helpers below only identify it for suppression.
const WORKSPACE_DIRECTORY_MISSING_CODE = "WORKSPACE_DIRECTORY_MISSING";

/**
 * Client-side pre-flight refusal, mirroring the runtime's 409. Carries the
 * stable machine code on the error object so detection is structural — the
 * display copy can change freely without breaking suppression.
 */
export function workspaceDirectoryMissingBlockError(reason: string): Error {
  const error = new Error(reason);
  (error as Error & { code?: string }).code = WORKSPACE_DIRECTORY_MISSING_CODE;
  return error;
}

/**
 * True for both the runtime's typed pre-flight refusal (problem code) and the
 * client-side creation gate (coded Error), following cause chains. The walk
 * is depth-capped so a (buggy) self-referential cause chain cannot recurse
 * forever.
 */
export function isWorkspaceDirectoryMissingError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    if (current instanceof AnyHarnessError) {
      return current.problem.code === WORKSPACE_DIRECTORY_MISSING_CODE;
    }
    if (!(current instanceof Error)) {
      return false;
    }
    if ((current as Error & { code?: unknown }).code === WORKSPACE_DIRECTORY_MISSING_CODE) {
      return true;
    }
    current = (current as Error & { cause?: unknown }).cause;
  }
  return false;
}

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
    return gatedSessionModelMessage();
  }
  if (error.problem.code === UNSUPPORTED_SESSION_MODEL_CODE) {
    return "This target does not support the selected model yet. Update AnyHarness on the target or choose another model.";
  }
  if (error.problem.code === UNSUPPORTED_SESSION_MODE_CODE) {
    return "This target does not support the selected session mode yet. Update AnyHarness on the target or choose another mode.";
  }
  return null;
}

function gatedSessionModelMessage(): string {
  return "This model is not available for the current authentication method. Choose an available model or change agent authentication in Settings, then try again.";
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
