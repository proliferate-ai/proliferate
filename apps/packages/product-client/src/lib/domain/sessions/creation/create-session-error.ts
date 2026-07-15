import { AnyHarnessError } from "@anyharness/sdk";
import { WORKTREE_MISSING_SEND_BLOCKED_REASON } from "#product/lib/domain/workspaces/availability";

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
 * True for both the runtime's typed pre-flight refusal and the client-side
 * creation gate (which throws the shared blocked-reason string).
 */
export function isWorkspaceDirectoryMissingError(error: unknown): boolean {
  if (error instanceof AnyHarnessError) {
    return error.problem.code === WORKSPACE_DIRECTORY_MISSING_CODE;
  }
  if (error instanceof Error) {
    return error.message === WORKTREE_MISSING_SEND_BLOCKED_REASON
      || isWorkspaceDirectoryMissingError((error as Error & { cause?: unknown }).cause);
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
