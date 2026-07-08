/**
 * Pure workflow-run + step-run status derivation and presentation (spec 3.6).
 *
 * The run lifecycle statuses mirror the server
 * (`constants/workflows.py::WORKFLOW_RUN_STATUS_*`). The step-run views are a
 * client-side projection the run timeline renders from the run's cursor,
 * status, and opaque `step_outputs` — read defensively, since the runtime
 * (W3/W4) owns the exact output shapes.
 */

import type { WorkflowDefinition, WorkflowStep, WorkflowStepKind } from "./definition";
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
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

const TERMINAL_RUN_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export type WorkflowStatusTone = "muted" | "running" | "positive" | "attention" | "danger";

export function isTerminalRunStatus(status: WorkflowRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

/** Non-terminal statuses should be polled (spec 3.6: simple interval, no stream). */
export function shouldPollRun(status: WorkflowRunStatus): boolean {
  return !isTerminalRunStatus(status);
}

export function workflowRunStatusLabel(status: WorkflowRunStatus): string {
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
  }
}

export function isWorkflowRunStatus(value: unknown): value is WorkflowRunStatus {
  return (
    typeof value === "string" && (WORKFLOW_RUN_STATUSES as readonly string[]).includes(value)
  );
}

/** Coerce an unknown wire status string to a known status (defaults to running). */
export function coerceRunStatus(value: unknown): WorkflowRunStatus {
  return isWorkflowRunStatus(value) ? value : "running";
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
  | "cancelled";

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

/** A step-action ledger row (spec 1.2), as returned by the run-detail endpoint. */
export interface WorkflowStepActionSummary {
  stepIndex: number;
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
  const kind = step.kind;
  if (kind === "notify" && step.channel === "slack") {
    // The runtime's own output never claims delivery for Slack — only the
    // server-observed action row (spec 8.4) does. No row yet ⇒ no chip.
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
  switch (kind) {
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
    case "notify": {
      // In-app has no delivery ledger — recording the step output IS the
      // delivery (spec: "always recorded in-app and in run history").
      const channel = typeof output.channel === "string" ? output.channel : "notification";
      return [{ kind: "notify", label: `Sent · ${channel}`, status: "sent" }];
    }
    case "human.approval": {
      if (output.decision === "approved" || output.decision === "denied") {
        return [
          {
            kind: "approval",
            label: output.decision === "approved" ? "Approved" : "Denied",
            approved: output.decision === "approved",
          },
        ];
      }
      return [];
    }
    case "agent.prompt":
      return [];
    case "agent.config": {
      const parts: string[] = [];
      if (typeof output.harness === "string") {
        parts.push(output.harness);
      }
      if (typeof output.model === "string") {
        parts.push(output.model);
      }
      return parts.length > 0 ? [{ kind: "text", label: parts.join(" · ") }] : [];
    }
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
  /** Opaque per-step outputs keyed by step index (string or number keys). */
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
  }
}

function stepOutputRecord(
  stepOutputs: Record<string, unknown> | null | undefined,
  index: number,
): Record<string, unknown> | null {
  if (!stepOutputs) {
    return null;
  }
  return asRecord(stepOutputs[String(index)]) ?? asRecord(stepOutputs[index as unknown as string]);
}

/**
 * Project a run into per-step timeline rows. When the run is terminal all steps
 * resolve; while running, the cursor step is active (goal-iterating when it
 * carries a goal) and later steps are pending.
 */
export function deriveStepRunViews(input: DeriveStepRunViewsInput): WorkflowStepRunView[] {
  const { definition, runStatus, stepOutputs, stepActions } = input;
  const terminalCompleted = runStatus === "completed";
  const cursor = input.stepCursor ?? (terminalCompleted ? definition.steps.length : 0);

  return definition.steps.map((step, index) => {
    const isGoalStep = step.kind === "agent.prompt" && step.goal !== undefined;
    const status = terminalCompleted
      ? "completed"
      : baseStepStatus(index, cursor, runStatus, isGoalStep);
    const output = stepOutputRecord(stepOutputs, index);
    const action = stepActions?.find((a) => a.stepIndex === index) ?? null;
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
