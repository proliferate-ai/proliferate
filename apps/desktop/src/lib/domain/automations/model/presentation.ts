import {
  AUTOMATION_REASONING_EFFORT_VALUES,
  type AutomationSupportedAgentKind,
} from "@/config/automations";

export const AUTOMATION_AGENT_KIND_LABELS: Record<AutomationSupportedAgentKind, string> = {
  claude: "Claude",
  codex: "Codex",
};

const AUTOMATION_REASONING_EFFORT_LABELS: Record<
  typeof AUTOMATION_REASONING_EFFORT_VALUES[number],
  string
> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
};

export const AUTOMATION_REASONING_EFFORT_OPTIONS = AUTOMATION_REASONING_EFFORT_VALUES.map((value) => ({
  value,
  label: AUTOMATION_REASONING_EFFORT_LABELS[value],
}));
