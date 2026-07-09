/**
 * Pure workflow-run + step-run status derivation and presentation (spec 3.6).
 *
 * The run lifecycle statuses mirror the server
 * (`constants/workflows.py::WORKFLOW_RUN_STATUS_*`). The step-run views are a
 * client-side projection the run timeline renders from the run's cursor,
 * status, and opaque `step_outputs` — read defensively, since the runtime
 * (W3/W4) owns the exact output shapes.
 */

import { flattenWorkflowSteps, type WorkflowDefinition, type WorkflowStep, type WorkflowStepKind } from "./definition";
import { workflowStepKindLabel, WORKFLOW_STEP_META } from "./presentation";

// --- Run status ----------------------------------------------------------------

export const WORKFLOW_RUN_STATUSES = [
  "pending_delivery",
  "delivered",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;

/**
 * Known wire statuses plus a client-side `"unknown"` sentinel. The run-status
 * enum is still growing server-side (1c's `missed`, billing's
 * `budget_blocked`) — a client build older than the server must render
 * whatever comes over the wire without crashing or lying. `coerceRunStatus`
 * never invents a false "running": an unrecognized status renders as a
 * blocked/attention state and stops polling (see `isTerminalRunStatus`)
 * rather than spinning forever on a status it can't interpret.
 */
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number] | "unknown";

const TERMINAL_RUN_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "unknown",
]);

export type WorkflowStatusTone = "muted" | "running" | "positive" | "attention" | "danger";

export function isTerminalRunStatus(status: WorkflowRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

/** Non-terminal statuses should be polled (spec 3.6: simple interval, no stream). */
export function shouldPollRun(status: WorkflowRunStatus): boolean {
  return !isTerminalRunStatus(status);
}

/**
 * `rawValue` is the original (possibly-unrecognized) wire value, only used to
 * render a readable fallback for `status === "unknown"` — e.g. a future
 * `budget_blocked` renders "Budget blocked" instead of a generic "Unknown".
 */
export function workflowRunStatusLabel(status: WorkflowRunStatus, rawValue?: unknown): string {
  switch (status) {
    case "pending_delivery":
      return "Queued";
    case "delivered":
      return "Starting";
    case "running":
      return "Running";
    case "waiting_approval":
      return "Waiting for approval";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "unknown":
      return humanizeUnknownStatus(rawValue);
  }
}

export function workflowRunStatusTone(status: WorkflowRunStatus): WorkflowStatusTone {
  switch (status) {
    case "pending_delivery":
    case "delivered":
      return "muted";
    case "running":
      return "running";
    case "waiting_approval":
      return "attention";
    case "completed":
      return "positive";
    case "failed":
      return "danger";
    case "cancelled":
      return "muted";
    case "unknown":
      return "attention";
  }
}

/** `"budget_blocked"` -> `"Budget blocked"`; a non-string/blank value -> `"Unknown"`. */
function humanizeUnknownStatus(rawValue: unknown): string {
  if (typeof rawValue !== "string") {
    return "Unknown";
  }
  const words = rawValue.trim().split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) {
    return "Unknown";
  }
  return words
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function isWorkflowRunStatus(value: unknown): value is WorkflowRunStatus {
  return (
    typeof value === "string" && (WORKFLOW_RUN_STATUSES as readonly string[]).includes(value)
  );
}

/** Coerce an unknown wire status string to a known status, or `"unknown"`. */
export function coerceRunStatus(value: unknown): WorkflowRunStatus {
  return isWorkflowRunStatus(value) ? value : "unknown";
}

// --- Step-run status -----------------------------------------------------------

export type WorkflowStepRunStatus =
  | "pending"
  | "running"
  | "goal_iterating"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled"
  /** The run's own status is unrecognized (see `WorkflowRunStatus`) while this
   * step is the live one — rendered as attention, not a false "running". */
  | "blocked";

export type WorkflowStepDotKind =
  | "pending"
  | "running"
  | "success"
  | "attention"
  | "failed"
  | "skipped";

export function stepRunStatusLabel(status: WorkflowStepRunStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "goal_iterating":
      return "Iterating";
    case "waiting_approval":
      return "Waiting for approval";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "cancelled":
      return "Cancelled";
    case "blocked":
      return "Blocked";
  }
}

export function stepRunDotKind(status: WorkflowStepRunStatus): WorkflowStepDotKind {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
    case "goal_iterating":
      return "running";
    case "waiting_approval":
    case "blocked":
      return "attention";
    case "completed":
      return "success";
    case "failed":
      return "failed";
    case "skipped":
    case "cancelled":
      return "skipped";
  }
}

// --- Typed step outputs --------------------------------------------------------

/** Delivery status for a notify-step chip (spec 8.4: rendered only from real observed data). */
export type WorkflowNotifyDeliveryStatus = "sent" | "pending" | "failed";

export type WorkflowStepOutputChip =
  | { kind: "exit"; label: string; ok: boolean }
  | { kind: "pr"; label: string; href: string | null }
  | { kind: "notify"; label: string; status: WorkflowNotifyDeliveryStatus; title?: string }
  | { kind: "approval"; label: string; approved: boolean }
  | { kind: "text"; label: string };

/**
 * A step-action ledger row (spec 1.2), as returned by the run-detail endpoint.
 * Keyed by the resolved plan's structured `stepKey` (§4), not a flat index —
 * mirrors the server's `StepActionResponse.stepKey`.
 */
export interface WorkflowStepActionSummary {
  stepKey: string;
  actionKind: string;
  status: string;
  errorMessage: string | null;
}

export interface WorkflowGoalLine {
  objective: string;
  status: string;
  iterations: number | null;
  tokensUsed: number | null;
}

export interface WorkflowStepSessionLink {
  sessionId: string;
  workspaceId: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function outputChipsFor(
  step: WorkflowStep,
  output: Record<string, unknown> | null,
  action: WorkflowStepActionSummary | null,
): WorkflowStepOutputChip[] {
  if (step.kind === "notify") {
    // Slack-only (E1b): the runtime's own output never claims delivery — only
    // the server-observed action row (spec 8.4) does. No row yet ⇒ no chip.
    if (!action) {
      return [];
    }
    if (action.status === "done") {
      return [{ kind: "notify", label: "Sent · slack", status: "sent" }];
    }
    if (action.status === "failed") {
      return [
        {
          kind: "notify",
          label: "Failed · slack",
          status: "failed",
          title: action.errorMessage ?? undefined,
        },
      ];
    }
    return [{ kind: "notify", label: "Pending · slack", status: "pending" }];
  }
  if (!output) {
    return [];
  }
  switch (step.kind) {
    case "shell.run": {
      if (typeof output.exit_code === "number") {
        return [{ kind: "exit", label: `exit ${output.exit_code}`, ok: output.exit_code === 0 }];
      }
      return [];
    }
    case "scm.open_pr": {
      const prNumber = typeof output.pr_number === "number" ? output.pr_number : null;
      const prUrl = typeof output.pr_url === "string" ? output.pr_url : null;
      if (prNumber !== null || prUrl !== null) {
        return [{ kind: "pr", label: prNumber !== null ? `PR #${prNumber}` : "PR", href: prUrl }];
      }
      return [];
    }
    case "agent.prompt":
      return [];
    case "agent.emit":
      return [{ kind: "text", label: `Captured ${step.name}` }];
    case "agent.config":
      return typeof output.model === "string" ? [{ kind: "text", label: output.model }] : [];
    case "branch": {
      const reason = typeof output.reason === "string" ? output.reason : null;
      return reason ? [{ kind: "text", label: reason }] : [];
    }
    case "workflow.include":
      // Never present in a resolved plan: the server inlines it away at StartRun
      // (L20), so a run view never sees one. Kept for exhaustiveness.
      return [];
  }
}

function goalLineFor(output: Record<string, unknown> | null): WorkflowGoalLine | null {
  const goal = asRecord(output?.goal);
  if (!goal || typeof goal.objective !== "string") {
    return null;
  }
  return {
    objective: goal.objective,
    status: typeof goal.status === "string" ? goal.status : "active",
    iterations: typeof goal.iterations === "number" ? goal.iterations : null,
    tokensUsed: typeof goal.tokens_used === "number" ? goal.tokens_used : null,
  };
}

function sessionLinkFor(
  output: Record<string, unknown> | null,
  fallbackWorkspaceId: string | null,
): WorkflowStepSessionLink | null {
  const sessionId = typeof output?.session_id === "string" ? output.session_id : null;
  if (!sessionId) {
    return null;
  }
  return {
    sessionId,
    workspaceId: typeof output?.workspace_id === "string" ? output.workspace_id : fallbackWorkspaceId,
  };
}

// --- Step-run view derivation --------------------------------------------------

export interface WorkflowStepRunView {
  index: number;
  kind: WorkflowStepKind;
  glyph: string;
  label: string;
  status: WorkflowStepRunStatus;
  dotKind: WorkflowStepDotKind;
  chips: WorkflowStepOutputChip[];
  goalLine: WorkflowGoalLine | null;
  sessionLink: WorkflowStepSessionLink | null;
}

export interface DeriveStepRunViewsInput {
  definition: WorkflowDefinition;
  runStatus: WorkflowRunStatus;
  /** 0-based index of the currently-executing step; null before delivery. */
  stepCursor: number | null;
  /** Opaque per-step outputs keyed by the resolved plan's structured stepKey. */
  stepOutputs?: Record<string, unknown> | null;
  anyharnessWorkspaceId?: string | null;
  /** The run's step-action ledger rows (spec 1.2), for delivery-status chips. */
  stepActions?: readonly WorkflowStepActionSummary[] | null;
}

function baseStepStatus(
  index: number,
  cursor: number,
  runStatus: WorkflowRunStatus,
  isGoalStep: boolean,
): WorkflowStepRunStatus {
  if (index < cursor) {
    return "completed";
  }
  if (index > cursor) {
    return runStatus === "cancelled" ? "cancelled" : runStatus === "failed" ? "skipped" : "pending";
  }
  // index === cursor
  switch (runStatus) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "waiting_approval":
      return "waiting_approval";
    case "running":
      return isGoalStep ? "goal_iterating" : "running";
    case "delivered":
    case "pending_delivery":
      return "pending";
    case "unknown":
      // A future status this client build doesn't recognize (e.g.
      // budget_blocked, missed) — render the live step as blocked/attention
      // rather than a false "running" or "completed". Later steps still fall
      // through the >cursor ternary above to "pending" (not "skipped"): an
      // unrecognized status might still resume, unlike a terminal failure.
      return "blocked";
  }
}

function stepOutputRecord(
  stepOutputs: Record<string, unknown> | null | undefined,
  stepKey: string,
): Record<string, unknown> | null {
  if (!stepOutputs) {
    return null;
  }
  return asRecord(stepOutputs[stepKey]);
}

/**
 * Project a run into per-step timeline rows. When the run is terminal all steps
 * resolve; while running, the cursor step is active (goal-iterating when it
 * carries a goal) and later steps are pending.
 */
export function deriveStepRunViews(input: DeriveStepRunViewsInput): WorkflowStepRunView[] {
  const { definition, runStatus, stepOutputs, stepActions } = input;
  const terminalCompleted = runStatus === "completed";
  const flatSteps = flattenWorkflowSteps(definition);
  const cursor = input.stepCursor ?? (terminalCompleted ? flatSteps.length : 0);

  return flatSteps.map(({ step, stepKey }, index) => {
    const isGoalStep = step.kind === "agent.prompt" && step.goal !== undefined;
    const status = terminalCompleted
      ? "completed"
      : baseStepStatus(index, cursor, runStatus, isGoalStep);
    const output = stepOutputRecord(stepOutputs, stepKey);
    const action = stepActions?.find((a) => a.stepKey === stepKey) ?? null;
    return {
      index,
      kind: step.kind,
      glyph: WORKFLOW_STEP_META[step.kind].glyph,
      label: workflowStepKindLabel(step.kind),
      status,
      dotKind: stepRunDotKind(status),
      chips: outputChipsFor(step, output, action),
      goalLine: isGoalStep ? goalLineFor(output) : null,
      sessionLink: sessionLinkFor(output, input.anyharnessWorkspaceId ?? null),
    };
  });
}

// --- Duration / cost / args formatting -----------------------------------------

/** `1m 20s`, `45s`, `2h 3m`. Between start and end (or `nowMs`). */
export function formatRunDuration(
  startedAtIso: string | null,
  finishedAtIso: string | null,
  nowMs: number = Date.now(),
): string | null {
  if (!startedAtIso) {
    return null;
  }
  const start = Date.parse(startedAtIso);
  if (Number.isNaN(start)) {
    return null;
  }
  const end = finishedAtIso ? Date.parse(finishedAtIso) : nowMs;
  const totalSecs = Math.max(0, Math.round((end - start) / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/** `$0.42` from the decimal string the server sends, or null. */
export function formatRunCostUsd(costUsd: string | null | undefined): string | null {
  if (costUsd == null) {
    return null;
  }
  const value = Number(costUsd);
  if (Number.isNaN(value)) {
    return null;
  }
  return `$${value.toFixed(2)}`;
}

/** `12.3k tokens`, `900 tokens`, or null. */
export function formatRunCostTokens(costTokens: number | null | undefined): string | null {
  if (costTokens == null) {
    return null;
  }
  if (costTokens >= 1000) {
    const thousands = costTokens / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k tokens`;
  }
  return `${costTokens} tokens`;
}

export interface WorkflowArgChip {
  name: string;
  value: string;
}

/** Header arg chips from a run's resolved args (opaque dict). */
export function workflowArgChips(args: Record<string, unknown> | null | undefined): WorkflowArgChip[] {
  if (!args) {
    return [];
  }
  return Object.entries(args).map(([name, value]) => ({
    name,
    value: renderArgValue(value),
  }));
}

function renderArgValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
