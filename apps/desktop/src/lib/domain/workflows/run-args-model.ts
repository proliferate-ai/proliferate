import type { WorkflowInputSpec } from "@proliferate/product-domain/workflows/definition";
import {
  FRESH_SESSION_CHOICE,
  type SlotSessionBinding,
} from "@proliferate/product-domain/workflows/run-launch";
import type { WorkflowTargetMode } from "@proliferate/product-domain/workflows/model";

export type WorkflowRunArgValue = string | number | boolean;

/** A selectable run target (a local runtime workspace, or a cloud workspace). */
export interface WorkflowRunTargetOption {
  id: string;
  label: string;
}

/** One agent slot from the definition — the unit a session binds to. */
export interface WorkflowRunSlotOption {
  slot: string;
  harness: string;
  model: string;
}

/** A live same-workspace session that may be bound to a compatible slot. */
export interface WorkflowRunSessionCandidate {
  id: string;
  title: string;
  harness: string;
  workspaceId?: string | null;
  lastActiveLabel?: string;
  heldByLabel?: string | null;
}

export interface WorkflowRunSubmit {
  args: Record<string, WorkflowRunArgValue>;
  targetMode: WorkflowTargetMode;
  localWorkspaceId?: string;
  cloudWorkspaceId?: string;
  sessionBindings: SlotSessionBinding[];
}

export function initialWorkflowRunArgValues(
  args: readonly WorkflowInputSpec[],
): Record<string, WorkflowRunArgValue> {
  const values: Record<string, WorkflowRunArgValue> = {};
  for (const arg of args) {
    if (arg.default !== undefined) {
      values[arg.name] = arg.default;
      continue;
    }
    switch (arg.type) {
      case "boolean":
        values[arg.name] = false;
        break;
      case "number":
        values[arg.name] = "" as unknown as number;
        break;
      case "choice":
        values[arg.name] = arg.choices?.[0] ?? "";
        break;
      case "text":
        values[arg.name] = "";
        break;
    }
  }
  return values;
}

export function resolvedWorkflowRunArgs(
  args: readonly WorkflowInputSpec[],
  values: Readonly<Record<string, WorkflowRunArgValue>>,
): Record<string, WorkflowRunArgValue> {
  const resolved: Record<string, WorkflowRunArgValue> = {};
  for (const arg of args) {
    const value = values[arg.name];
    if (value === "" || value === undefined) {
      continue;
    }
    resolved[arg.name] = arg.type === "number" ? Number(value) : value;
  }
  return resolved;
}

export function workflowRunSessionBindings(
  slots: readonly WorkflowRunSlotOption[],
  bindings: Readonly<Record<string, string>>,
): SlotSessionBinding[] {
  return slots.map((slot) => ({
    slot: slot.slot,
    sessionId: bindings[slot.slot] ?? FRESH_SESSION_CHOICE,
  }));
}
