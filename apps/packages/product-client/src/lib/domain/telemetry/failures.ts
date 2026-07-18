export type TelemetryFailureKind =
  | "aborted"
  | "configuration_error"
  | "network_error"
  | "permission_error"
  | "request_error"
  | "unknown_error";

const EXPECTED_ANYHARNESS_HOSTING_AVAILABILITY_CODES = new Set([
  "HOSTING_GH_NOT_INSTALLED",
  "HOSTING_GH_AUTH_REQUIRED",
  "HOSTING_REMOTE_UNSUPPORTED",
]);

const EXPECTED_ANYHARNESS_COWORK_LIFECYCLE_CODES = new Set([
  "COWORK_THREAD_NOT_FOUND",
]);

const EXPECTED_ANYHARNESS_REPOSITORY_VALIDATION_CODES = new Set([
  "REPO_ROOT_NOT_GIT_REPO",
  "REPO_ROOT_WORKTREE_UNSUPPORTED",
  "REPO_WORKSPACE_NOT_GIT_REPO",
  "REPO_WORKSPACE_WORKTREE_UNSUPPORTED",
]);

const EXPECTED_GITHUB_APP_STATE_CODES = new Set([
  "github_app_authorization_required",
  "github_app_authorization_expired",
  "github_app_installation_required",
  "github_app_repo_not_covered",
  "github_repo_access_required",
]);

export function classifyTelemetryFailure(error: unknown): TelemetryFailureKind {
  if (errorName(error) === "AbortError") {
    return "aborted";
  }

  const status = errorStatus(error);
  if (status !== null) {
    if (status === 401 || status === 403) {
      return "permission_error";
    }
    if (status >= 400 && status < 500) {
      return "configuration_error";
    }
    if (status >= 500) {
      return "request_error";
    }
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.trim().toLowerCase();

  if (
    normalized.includes("network")
    || normalized.includes("fetch")
    || normalized.includes("timeout")
    || normalized.includes("timed out")
    || normalized.includes("socket")
    || normalized.includes("connection")
  ) {
    return "network_error";
  }

  if (
    normalized.includes("not configured")
    || normalized.includes("configuration")
    || normalized.includes("missing")
    || normalized.includes("invalid")
    || normalized.includes("unsupported")
  ) {
    return "configuration_error";
  }

  if (
    normalized.includes("permission")
    || normalized.includes("forbidden")
    || normalized.includes("unauthorized")
  ) {
    return "permission_error";
  }

  return "unknown_error";
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") {
    return status;
  }

  const problem = (error as { problem?: unknown }).problem;
  if (typeof problem !== "object" || problem === null) {
    return null;
  }
  const problemStatus = (problem as { status?: unknown }).status;
  return typeof problemStatus === "number" ? problemStatus : null;
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") {
    return code;
  }

  const problem = (error as { problem?: unknown }).problem;
  if (typeof problem !== "object" || problem === null) {
    return null;
  }
  const problemCode = (problem as { code?: unknown }).code;
  return typeof problemCode === "string" ? problemCode : null;
}

function errorName(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

/**
 * Returns true only for structurally represented query control states. The
 * global query boundary deliberately does not use the classifier's message
 * fallbacks: an unknown/programming error remains reportable even when its
 * wording happens to contain terms such as "missing" or "configuration".
 */
export function isExpectedQueryTelemetryError(error: unknown): boolean {
  if (errorName(error) === "AbortError") {
    return true;
  }

  const status = errorStatus(error);
  if (status !== null && status >= 500) {
    return false;
  }
  if (status === 401 || status === 403) {
    return true;
  }

  const code = errorCode(error);
  return code !== null
    && (
      EXPECTED_ANYHARNESS_HOSTING_AVAILABILITY_CODES.has(code)
      || EXPECTED_ANYHARNESS_COWORK_LIFECYCLE_CODES.has(code)
      || EXPECTED_GITHUB_APP_STATE_CODES.has(code)
    );
}

/**
 * Returns true only for typed repository-selection validation states that the
 * owning mutation workflow already renders to the user. Other mutation
 * failures remain reportable, including generic 4xx responses.
 */
export function isExpectedMutationTelemetryError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status !== null && status >= 500) {
    return false;
  }

  const code = errorCode(error);
  return code !== null
    && EXPECTED_ANYHARNESS_REPOSITORY_VALIDATION_CODES.has(code);
}
