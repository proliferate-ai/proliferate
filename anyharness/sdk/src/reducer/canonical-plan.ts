import type { CanonicalPlan, PlanItem, ToolCallItem, TranscriptState } from "../types/reducer.js";
import { selectPendingApprovalInteraction } from "./transcript.js";

export function deriveCanonicalPlan(transcript: TranscriptState): CanonicalPlan | null {
  const pendingApproval = selectPendingApprovalInteraction(transcript);
  const items = Object.values(transcript.itemsById)
    .filter((item): item is PlanItem | ToolCallItem => item.kind === "plan" || item.kind === "tool_call")
    .sort((left, right) => {
      if (left.startedSeq !== right.startedSeq) {
        return left.startedSeq - right.startedSeq;
      }
      return left.lastUpdatedSeq - right.lastUpdatedSeq;
    });

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "plan") {
      const structuredPlan = deriveStructuredCanonicalPlan(item);
      if (structuredPlan) {
        return structuredPlan;
      }
      continue;
    }

    if (item.kind === "tool_call") {
      const modeSwitchPlan = deriveModeSwitchCanonicalPlan(item, pendingApproval);
      if (modeSwitchPlan) {
        return modeSwitchPlan;
      }
    }
  }

  return null;
}

function deriveStructuredCanonicalPlan(item: PlanItem): CanonicalPlan | null {
  // Claude ACP currently emits `plan` updates from TodoWrite, which represent
  // internal task tracking rather than the formal presented plan we surface in
  // the dedicated plan UI. Exclude that source until Claude emits presented
  // plans directly through ACP.
  if (item.sourceAgentKind === "claude") {
    return null;
  }

  if (item.entries.length === 0) {
    return null;
  }

  return {
    title: "Plan",
    sourceKind: "structured_plan",
    itemId: item.itemId,
    turnId: item.turnId,
    entries: item.entries,
    body: null,
    isActive: item.status === "in_progress",
  };
}

function deriveModeSwitchCanonicalPlan(
  item: ToolCallItem,
  pendingApproval: ReturnType<typeof selectPendingApprovalInteraction>,
): CanonicalPlan | null {
  if (!isClaudeExitPlanModeCall(item)) {
    return null;
  }

  const body = extractToolPlanBody(item);
  if (!body) {
    return null;
  }

  return {
    title: "Plan",
    sourceKind: "mode_switch",
    itemId: item.itemId,
    turnId: item.turnId,
    entries: [],
    body,
    isActive:
      item.status === "in_progress"
      || item.approvalState === "pending"
      || (item.toolCallId != null && pendingApproval?.toolCallId === item.toolCallId),
  };
}

function isClaudeExitPlanModeCall(item: ToolCallItem): boolean {
  if (item.sourceAgentKind !== "claude") {
    return false;
  }

  if (item.nativeToolName === "ExitPlanMode") {
    return true;
  }

  return item.semanticKind === "mode_switch" && normalizeWhitespace(item.title) === "ready to code?";
}

function extractToolPlanBody(item: ToolCallItem): string | null {
  const textParts = item.contentParts
    .flatMap((part) => part.type === "tool_result_text" ? [part.text.trim()] : [])
    .filter((text) => text.length > 0);

  if (textParts.length > 0) {
    return textParts.join("\n\n");
  }

  const rawInputPlan = getStringField(item.rawInput, "plan");
  if (rawInputPlan) {
    return rawInputPlan;
  }

  return getStringField(item.rawOutput, "plan");
}

function getStringField(value: unknown, key: string): string | null {
  if (!isObject(value)) {
    return null;
  }

  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeWhitespace(value: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}
