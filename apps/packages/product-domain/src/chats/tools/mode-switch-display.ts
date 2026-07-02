import type { ToolCallItem } from "@anyharness/sdk";

/**
 * Exact tool names that represent a real harness mode transition. The SDK's
 * semanticKind derivation is intentionally broad (any tool whose name merely
 * CONTAINS "mode" becomes `mode_switch`), so the renderer narrows it here:
 * only these tools get the phase-divider treatment; every other
 * `mode_switch`-tagged tool falls back to a normal tool row.
 */
const KNOWN_MODE_SWITCH_TOOL_NAMES = new Set([
  "switch_mode",
  "switchmode",
  "set_mode",
  "setmode",
  "mode_switch",
  "session/set_mode",
  "exit_plan_mode",
  "exitplanmode",
]);

const FROM_MODE_KEYS = [
  "from",
  "from_mode",
  "fromMode",
  "previous_mode",
  "previousMode",
  "old_mode",
  "oldMode",
] as const;

const TO_MODE_KEYS = [
  "mode",
  "mode_id",
  "modeId",
  "to",
  "to_mode",
  "toMode",
  "target_mode",
  "targetMode",
  "new_mode",
  "newMode",
] as const;

export interface ModeSwitchDisplay {
  /** e.g. "Plan mode → Default", "Default mode", or "Mode changed". */
  label: string;
}

/**
 * True only for tool calls whose name is an exact known mode tool. Used both
 * to pick the divider visual and to keep these rows out of collapsed-action
 * groups (unknown "mode"-ish tools collapse like any other tool).
 */
export function isKnownModeSwitchToolCall(item: ToolCallItem): boolean {
  if (item.semanticKind !== "mode_switch") {
    return false;
  }
  return KNOWN_MODE_SWITCH_TOOL_NAMES.has(normalizeModeToolName(item));
}

/**
 * Derives the phase-divider label for a known mode tool: "Plan mode →
 * Default" when both sides are present in the tool input/result, the single
 * mode name when only the target is known, and "Mode changed" otherwise.
 * Returns null for tools that are not exact known mode tools.
 */
export function deriveModeSwitchDisplay(item: ToolCallItem): ModeSwitchDisplay | null {
  if (!isKnownModeSwitchToolCall(item)) {
    return null;
  }

  const fromMode = readModeField(item.rawInput, FROM_MODE_KEYS)
    ?? readModeField(item.rawOutput, FROM_MODE_KEYS);
  const toMode = readModeField(item.rawInput, TO_MODE_KEYS)
    ?? readModeField(item.rawOutput, TO_MODE_KEYS);

  if (fromMode && toMode) {
    return { label: `${formatModeName(fromMode, { withSuffix: true })} → ${formatModeName(toMode)}` };
  }
  if (toMode) {
    return { label: formatModeName(toMode, { withSuffix: true }) };
  }
  if (fromMode) {
    return { label: `${formatModeName(fromMode, { withSuffix: true })} ended` };
  }
  return { label: "Mode changed" };
}

function normalizeModeToolName(item: ToolCallItem): string {
  const nativeName = (item.nativeToolName ?? "").trim().toLowerCase();
  if (nativeName.length > 0) {
    return nativeName;
  }
  return (item.title ?? "").trim().toLowerCase();
}

function readModeField(
  value: unknown,
  keys: readonly string[],
): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

/** "plan" → "Plan mode"; "acceptEdits" → "Accept edits"; keeps an existing "mode" suffix. */
function formatModeName(mode: string, options?: { withSuffix?: boolean }): string {
  const words = mode
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  const humanized = words.charAt(0).toUpperCase() + words.slice(1);
  if (!options?.withSuffix || /\bmode\b/i.test(humanized)) {
    return humanized;
  }
  return `${humanized} mode`;
}
