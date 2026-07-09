/**
 * Workflow list/run summary view models + product policy (spec 3.6 / 6).
 *
 * Pure mappers the home tabs render from: a Runs-table row and the free-plan
 * create cap. The cap mirrors the server (`workflows/domain/policy.py`); the UI
 * enforces it for a friendly message, the server enforces it for real.
 */

import {
  coerceRunStatus,
  formatRunCostTokens,
  formatRunCostUsd,
  formatRunDuration,
  workflowRunStatusLabel,
  workflowRunStatusTone,
  type WorkflowStatusTone,
} from "./run-status";
import { FREE_PLAN_MAX_WORKFLOWS_PER_USER } from "./definition";

/** Run delivery lane (spec 3.2; v1 personal only). Mirrors the StartRun target. */
export type WorkflowTargetMode = "local" | "personal_cloud";

export type WorkflowTriggerKind = "manual" | "schedule" | "poll" | "chat" | "agent" | "api";

export function workflowTriggerLabel(kind: string): string {
  switch (kind) {
    case "manual":
      return "Manual";
    case "schedule":
      return "Schedule";
    case "poll":
      return "Poll";
    case "chat":
      return "Chat";
    case "agent":
      return "Agent";
    case "api":
      return "API";
    default:
      return kind;
  }
}

export interface WorkflowRunRowView {
  id: string;
  workflowId: string;
  workflowName: string;
  triggerLabel: string;
  statusLabel: string;
  statusTone: WorkflowStatusTone;
  durationLabel: string | null;
  costLabel: string | null;
  startedLabel: string | null;
}

export interface BuildWorkflowRunRowInput {
  id: string;
  workflowId: string;
  /** Resolved workflow name; falls back to the id when unknown. */
  workflowName: string | null;
  triggerKind: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  costUsd: string | null;
  costTokens: number | null;
  nowMs?: number;
}

export function buildWorkflowRunRow(input: BuildWorkflowRunRowInput): WorkflowRunRowView {
  const status = coerceRunStatus(input.status);
  const cost = formatRunCostUsd(input.costUsd) ?? formatRunCostTokens(input.costTokens);
  return {
    id: input.id,
    workflowId: input.workflowId,
    workflowName: input.workflowName ?? input.workflowId,
    triggerLabel: workflowTriggerLabel(input.triggerKind),
    statusLabel: workflowRunStatusLabel(status, input.status),
    statusTone: workflowRunStatusTone(status),
    durationLabel: formatRunDuration(input.startedAt, input.finishedAt, input.nowMs),
    costLabel: cost,
    startedLabel: input.startedAt,
  };
}

// --- Free-plan policy (spec 6) -------------------------------------------------

export function freePlanWorkflowLimit(): number {
  return FREE_PLAN_MAX_WORKFLOWS_PER_USER;
}

/**
 * Whether a user with `activeWorkflowCount` non-archived workflows may create
 * another. `maxAllowed = null` means unlimited (a future paid plan).
 */
export function workflowCreateAllowed(
  activeWorkflowCount: number,
  maxAllowed: number | null,
): boolean {
  if (maxAllowed === null) {
    return true;
  }
  return activeWorkflowCount < maxAllowed;
}
