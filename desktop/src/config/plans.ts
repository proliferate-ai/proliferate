export const PLAN_ATTACHMENT_LIMIT = 4;

export const PLAN_PICKER_SEARCH_PLACEHOLDER = "Search title, agent, or status";

const PLAN_AGENT_KIND_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

const PLAN_DECISION_STATE_LABELS: Record<string, string> = {
  approved: "Approved",
  pending: "Pending",
  rejected: "Rejected",
  superseded: "Superseded",
};

export function formatPlanAgentKindLabel(kind: string): string {
  return PLAN_AGENT_KIND_LABELS[kind] ?? titleCaseIdentifier(kind);
}

export function formatPlanDecisionStateLabel(state: string): string {
  return PLAN_DECISION_STATE_LABELS[state] ?? titleCaseIdentifier(state);
}

function titleCaseIdentifier(value: string): string {
  return value
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
