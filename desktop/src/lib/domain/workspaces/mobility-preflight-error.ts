import { AnyHarnessError } from "@anyharness/sdk";

export function describeMobilityPreflightLoadFailure(args: {
  error: unknown;
  status?: string;
  fetchStatus?: string;
}): string {
  const diagnostic = describeUnknownError(args.error)
    ?? describeQueryState(args.status, args.fetchStatus)
    ?? "No preflight data returned.";

  return `Failed to load workspace mobility preflight: ${diagnostic}`;
}

function describeUnknownError(error: unknown): string | null {
  if (!error) {
    return null;
  }

  if (error instanceof AnyHarnessError) {
    const problem = error.problem;
    const code = problem.code?.trim();
    const detail = problem.detail?.trim() || problem.title?.trim();
    const status = Number.isFinite(problem.status) ? `HTTP ${problem.status}` : null;
    return [code, status, detail].filter(Boolean).join(" - ") || error.message;
  }

  if (error instanceof Error) {
    return error.message || error.name;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function describeQueryState(status?: string, fetchStatus?: string): string | null {
  if (!status && !fetchStatus) {
    return null;
  }
  return `query status=${status ?? "unknown"}, fetchStatus=${fetchStatus ?? "unknown"}`;
}
