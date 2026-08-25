import { AnyHarnessError } from "@anyharness/sdk";

/** Status plus stable code from either plane's error envelope. */
export interface WorkflowCloudError {
  status: number;
  code: string | null;
}

export function inspectWorkflowCloudError(error: unknown): WorkflowCloudError | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const status = "status" in error ? error.status : null;
  const code = "code" in error ? error.code : null;
  if (typeof status !== "number" || (code !== null && typeof code !== "string")) {
    return null;
  }
  return { status, code };
}

/**
 * The runtime plane's counterpart. `AnyHarnessError` carries RFC 7807 fields
 * under `.problem`, not at the top level, so `inspectWorkflowCloudError` never
 * matches one and every runtime failure would otherwise read as uncoded.
 */
export function inspectWorkflowRuntimeError(error: unknown): WorkflowCloudError | null {
  if (!(error instanceof AnyHarnessError)) {
    return null;
  }
  return { status: error.problem.status, code: error.problem.code ?? null };
}
