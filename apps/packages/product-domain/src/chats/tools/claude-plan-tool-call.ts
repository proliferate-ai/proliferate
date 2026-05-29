import type { ToolCallItem } from "@anyharness/sdk";

/**
 * Detects Claude's ExitPlanMode tool call. This is the tool call that carries
 * a markdown plan body in the rawInput and pairs with a switch_mode permission
 * request titled "Ready to code?".
 */
export function isClaudeExitPlanModeCall(item: ToolCallItem): boolean {
  if (item.sourceAgentKind !== "claude") {
    return false;
  }

  if (item.nativeToolName === "ExitPlanMode") {
    return true;
  }

  return (
    item.semanticKind === "mode_switch"
    && normalizeWhitespace(item.title) === "ready to code?"
  );
}

/**
 * Extracts the markdown plan body from a Claude ExitPlanMode tool call.
 * Tries `tool_result_text` content parts first, then `rawInput.plan`, then
 * `rawOutput.plan`. Returns null if no body is present.
 */
export function extractClaudePlanBody(item: ToolCallItem): string | null {
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
