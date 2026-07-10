/**
 * Pure relay diff logic for the desktop lane (spec 3.2).
 *
 * The relay polls the local runtime's run view and forwards observed transitions
 * to the server `/status` endpoint. That endpoint enforces the legal transition
 * table (`delivered -> running -> {waiting_approval|terminal}`), so the relay must
 * (a) always report `running` before any non-running status and (b) debounce
 * repeats. This module computes, per poll, the ordered status reports to send and
 * the next relay state — no I/O, no React.
 */

export type RelayRunStatus =
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

const TERMINAL: ReadonlySet<RelayRunStatus> = new Set(["completed", "failed", "cancelled"]);

export function isRelayTerminal(status: RelayRunStatus): boolean {
  return TERMINAL.has(status);
}

/** The minimal shape the relay reads from the local runtime's run view. */
export interface RelayObservedRun {
  status: RelayRunStatus;
  stepCursor: number;
  workspaceId: string;
  sessionIds?: string[];
  steps?: { stepIndex: number; output?: unknown }[];
  errorCode?: string | null;
  errorMessage?: string | null;
}

/** The `/status` request body (camelCase to match the server aliases). */
export interface RelayStatusReport {
  status: RelayRunStatus;
  stepCursor: number;
  stepOutputs: Record<string, unknown> | null;
  anyharnessWorkspaceId: string;
  anyharnessSessionIds: string[] | null;
  errorCode: string | null;
  errorMessage: string | null;
  /**
   * The claim this device holds on the run (2a). Stamped onto every report for a
   * claimed LOCAL scheduled run so the server can reject a reclaimed laptop's stale
   * relay (owner auth alone can't tell two of the same user's devices apart).
   * Omitted for a manual/chat local run, which carries no claim.
   */
  claimId?: string;
}

export interface RelayRunState {
  reportedRunning: boolean;
  lastSignature: string | null;
  done: boolean;
}

export function initialRelayState(): RelayRunState {
  return { reportedRunning: false, lastSignature: null, done: false };
}

function stepOutputsFrom(view: RelayObservedRun): Record<string, unknown> | null {
  if (!view.steps || view.steps.length === 0) {
    return null;
  }
  const outputs: Record<string, unknown> = {};
  for (const step of view.steps) {
    if (step.output !== undefined && step.output !== null) {
      outputs[String(step.stepIndex)] = step.output;
    }
  }
  return Object.keys(outputs).length > 0 ? outputs : null;
}

function signatureFor(
  status: RelayRunStatus,
  cursor: number,
  outputs: Record<string, unknown> | null,
): string {
  return `${status}:${cursor}:${outputs ? JSON.stringify(outputs) : ""}`;
}

/**
 * Given the prior relay state and a fresh local view, return the ordered status
 * reports to POST and the next state. Reports are already legal transitions.
 */
export function planRelayReports(
  prev: RelayRunState,
  view: RelayObservedRun,
  options?: { claimId?: string | null },
): { reports: RelayStatusReport[]; state: RelayRunState } {
  const outputs = stepOutputsFrom(view);
  const base = {
    stepCursor: view.stepCursor,
    stepOutputs: outputs,
    anyharnessWorkspaceId: view.workspaceId,
    anyharnessSessionIds: view.sessionIds ?? null,
    errorCode: view.errorCode ?? null,
    errorMessage: view.errorMessage ?? null,
    // Thread the held claim (2a) onto every report so a reclaimed laptop's stale
    // relay is rejected. Absent for a manual/chat local run (no claim).
    ...(options?.claimId ? { claimId: options.claimId } : {}),
  };
  const reports: RelayStatusReport[] = [];
  const state: RelayRunState = { ...prev };

  // (a) A `running` report must precede any non-running one so the server can
  // walk `delivered -> running -> ...`.
  if (!state.reportedRunning) {
    reports.push({ ...base, status: "running" });
    state.reportedRunning = true;
    state.lastSignature = signatureFor("running", view.stepCursor, outputs);
  }

  const observedSignature = signatureFor(view.status, view.stepCursor, outputs);
  if (view.status !== "running") {
    if (state.lastSignature !== observedSignature) {
      reports.push({ ...base, status: view.status });
      state.lastSignature = observedSignature;
    }
  } else if (reports.length === 0 && state.lastSignature !== observedSignature) {
    // Still running, but the cursor/outputs advanced — refresh the ledger.
    reports.push({ ...base, status: "running" });
    state.lastSignature = observedSignature;
  }

  state.done = isRelayTerminal(view.status);
  return { reports, state };
}
