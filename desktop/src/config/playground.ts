export type ScenarioKey =
  | "clean"
  | "cowork-clean"
  | "cowork-pending"
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
  | "pending-prompts-with-approval";

interface Scenario {
  label: string;
}

export const SCENARIOS: Record<ScenarioKey, Scenario> = {
  "clean": { label: "Clean" },
  "cowork-clean": { label: "Cowork clean" },
  "cowork-pending": { label: "Cowork pending" },
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
};

export const DEFAULT_SCENARIO: ScenarioKey = "clean";

export function resolveScenarioKey(raw: string | null): ScenarioKey {
  if (raw && raw in SCENARIOS) {
    return raw as ScenarioKey;
  }
  return DEFAULT_SCENARIO;
}
