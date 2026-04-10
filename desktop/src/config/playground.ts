export type ScenarioKey =
  | "clean"
  | "todos-short"
  | "todos-mid"
  | "todos-long"
  | "execute-approval"
  | "edit-approval"
  | "claude-plan-short"
  | "claude-plan-long";

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
};

export const DEFAULT_SCENARIO: ScenarioKey = "clean";

export function resolveScenarioKey(raw: string | null): ScenarioKey {
  if (raw && raw in SCENARIOS) {
    return raw as ScenarioKey;
  }
  return DEFAULT_SCENARIO;
}
