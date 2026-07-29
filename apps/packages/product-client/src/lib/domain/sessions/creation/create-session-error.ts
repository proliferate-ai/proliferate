import { AnyHarnessError } from "@anyharness/sdk";

// The single typed model refusal (model-catalog.md "Launch validation"): the
// requested model did not resolve against the harness's composed observation.
// The former gated taxonomy (the gated code + its required-contexts payload)
// is deleted — "why isn't my model here" is answered by the settings surface,
// not a launch error.
const UNSUPPORTED_SESSION_MODEL_CODE = "SESSION_MODEL_UNSUPPORTED";
const UNSUPPORTED_SESSION_MODE_CODE = "SESSION_MODE_UNSUPPORTED";
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

/**
 * The failure as a cause string, following one wrap.
 *
 * Replaces `formatSessionCreateToastMessage`, which took a `fallbackPrefix` and
 * returned `${prefix}: ${message}` — a written headline concatenated with an
 * exception, which is the shape the toast API and its guard now forbid. Callers
 * write their own headline and pass this as `cause`.
 */
export function formatSessionCreateCause(error: unknown): string {
  return unsupportedSessionSelectionMessage(error)
    ?? unsupportedSessionSelectionMessage(errorCause(error))
    ?? formatSessionCreateFailureMessage(error);
}

export function toSessionCreateFailureDisplayError(error: unknown): unknown {
  if (!isUnsupportedSessionSelectionError(error)) {
    return error;
  }
  const displayError = new Error(formatSessionCreateFailureMessage(error));
  (displayError as Error & { cause?: unknown }).cause = error;
  return displayError;
}

/**
 * The refusal in the runtime's own words.
 *
 * It used to be rewritten into "This target does not support the selected model
 * yet" — a sentence that names neither side of a fact the runtime states
 * precisely ("model 'x' is not supported for agent 'y': not served by …"). The
 * rewrite was strictly less informative than what it replaced, and the surfaces
 * that show this now say which model and which target themselves, so the raw
 * detail is kept as the cause a user can report.
 */
function unsupportedSessionSelectionMessage(error: unknown): string | null {
  if (!(error instanceof AnyHarnessError)) {
    return null;
  }
  if (
    error.problem.code === UNSUPPORTED_SESSION_MODEL_CODE
    || error.problem.code === UNSUPPORTED_SESSION_MODE_CODE
  ) {
    return error.problem.detail ?? error.problem.title;
  }
  return null;
}

function isUnsupportedSessionSelectionError(error: unknown): boolean {
  return error instanceof AnyHarnessError
    && (
      error.problem.code === UNSUPPORTED_SESSION_MODEL_CODE
      || error.problem.code === UNSUPPORTED_SESSION_MODE_CODE
    );
}

function errorCause(error: unknown): unknown {
  return error instanceof Error
    ? (error as Error & { cause?: unknown }).cause
    : undefined;
}
