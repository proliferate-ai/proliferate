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
