export type ScenarioKey =
  | "clean"
  | "todos-short"
  | "todos-mid"
  | "todos-long"
  | "execute-approval"
  | "edit-approval"
  | "claude-plan-short"
  | "claude-plan-long"
  | "pending-prompts-single"
  | "pending-prompts-multi"
  | "pending-prompts-editing"
  | "pending-prompts-with-approval"
  | "user-input-single-option"
  | "user-input-single-freeform"
  | "user-input-option-plus-other"
  | "user-input-secret"
  | "user-input-multi-question"
  | "mcp-elicitation-boolean"
  | "mcp-elicitation-enum"
  | "mcp-elicitation-multi-select"
  | "mcp-elicitation-mixed-required"
  | "mcp-elicitation-url"
  | "mcp-elicitation-validation-error"
  | "mcp-elicitation-cancel-decline"
  | "status-background"
  | "status-hook-running"
  | "status-hook-completed"
  | "status-hook-blocked"
  | "status-deprecation"
  | "status-assistant-handoff"
  | "gemini-retry-status"
  | "gemini-blocked-warning"
  | "gemini-no-response-warning"
  | "gemini-mcp-approval-options"
  | "gemini-tool-before-approval"
  | "mobility-local-actionable"
  | "mobility-local-blocked"
  | "mobility-unpublished-branch"
  | "mobility-unpushed-commits"
  | "mobility-out-of-sync-branch"
  | "mobility-in-flight"
  | "mobility-failed";

interface Scenario {
  label: string;
}

export const SCENARIOS: Record<ScenarioKey, Scenario> = {
  "clean": { label: "Clean" },
  "todos-short": { label: "Todos (3)" },
  "todos-mid": { label: "Todos (5)" },
  "todos-long": { label: "Todos (12)" },
  "execute-approval": { label: "Execute approval" },
  "edit-approval": { label: "Edit approval" },
  "claude-plan-short": { label: "Plan approval (short)" },
  "claude-plan-long": { label: "Plan approval (long)" },
  "pending-prompts-single": { label: "Queue (1 row)" },
  "pending-prompts-multi": { label: "Queue (3 rows)" },
  "pending-prompts-editing": { label: "Queue (editing row)" },
  "pending-prompts-with-approval": { label: "Queue + approval" },
  "user-input-single-option": { label: "User input (option)" },
  "user-input-single-freeform": { label: "User input (text)" },
  "user-input-option-plus-other": { label: "User input (other)" },
  "user-input-secret": { label: "User input (secret)" },
  "user-input-multi-question": { label: "User input (multi)" },
  "mcp-elicitation-boolean": { label: "MCP form (boolean)" },
  "mcp-elicitation-enum": { label: "MCP form (enum)" },
  "mcp-elicitation-multi-select": { label: "MCP form (multi)" },
  "mcp-elicitation-mixed-required": { label: "MCP form (mixed)" },
  "mcp-elicitation-url": { label: "MCP URL reveal" },
  "mcp-elicitation-validation-error": { label: "MCP validation" },
  "mcp-elicitation-cancel-decline": { label: "MCP cancel/decline" },
  "status-background": { label: "Status background" },
  "status-hook-running": { label: "Hook running" },
  "status-hook-completed": { label: "Hook completed" },
  "status-hook-blocked": { label: "Hook blocked" },
  "status-deprecation": { label: "Deprecation notice" },
  "status-assistant-handoff": { label: "Prose handoff" },
  "gemini-retry-status": { label: "Gemini retry" },
  "gemini-blocked-warning": { label: "Gemini blocked" },
  "gemini-no-response-warning": { label: "Gemini no response" },
  "gemini-mcp-approval-options": { label: "Gemini MCP approval" },
  "gemini-tool-before-approval": { label: "Gemini pre-approval tool" },
  "mobility-local-actionable": { label: "Mobility (actionable)" },
  "mobility-local-blocked": { label: "Mobility (blocked)" },
  "mobility-unpublished-branch": { label: "Mobility (publish branch)" },
  "mobility-unpushed-commits": { label: "Mobility (push commits)" },
  "mobility-out-of-sync-branch": { label: "Mobility (out of sync)" },
  "mobility-in-flight": { label: "Mobility (in flight)" },
  "mobility-failed": { label: "Mobility (failed)" },
};

export const DEFAULT_SCENARIO: ScenarioKey = "clean";

export function resolveScenarioKey(raw: string | null): ScenarioKey {
  if (raw && raw in SCENARIOS) {
    return raw as ScenarioKey;
  }
  return DEFAULT_SCENARIO;
}

export type PlaygroundScenarioSelection =
  | {
      kind: "fixture";
      key: ScenarioKey;
      raw: string;
    }
  | {
      kind: "recording";
      recordingId: string;
      raw: string;
    };

export function resolvePlaygroundScenarioSelection(
  raw: string | null,
): PlaygroundScenarioSelection {
  if (raw && raw in SCENARIOS) {
    return {
      kind: "fixture",
      key: raw as ScenarioKey,
      raw,
    };
  }

  if (raw && raw.trim().endsWith(".json")) {
    return {
      kind: "recording",
      recordingId: raw.trim(),
      raw: raw.trim(),
    };
  }

  return {
    kind: "fixture",
    key: DEFAULT_SCENARIO,
    raw: DEFAULT_SCENARIO,
  };
}
