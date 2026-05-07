import {
  AUTOMATION_EXECUTION_TARGET_VALUES,
  AUTOMATION_REASONING_EFFORT_VALUES,
  AUTOMATION_SCHEDULE_PRESETS,
  type AutomationSupportedAgentKind,
} from "@/config/automations";
import { timeForRrule, type AutomationSchedulePresetOrCustom } from "@/lib/domain/automations/schedule";

export const AUTOMATION_EXECUTION_TARGET_OPTIONS = AUTOMATION_EXECUTION_TARGET_VALUES.map((value) => ({
  value,
  label: value === "cloud" ? "Cloud" : "Local",
}));

export const AUTOMATION_AGENT_KIND_LABELS: Record<AutomationSupportedAgentKind, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
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

const AUTOMATION_SCHEDULE_PRESET_LABELS: Record<
  typeof AUTOMATION_SCHEDULE_PRESETS[number]["value"],
  string
> = {
  hourly: "Hourly",
  daily: "Daily",
  weekdays: "Weekdays",
  weekends: "Weekends",
};

export const AUTOMATION_SCHEDULE_PRESET_OPTIONS = AUTOMATION_SCHEDULE_PRESETS.map((preset) => ({
  ...preset,
  label: AUTOMATION_SCHEDULE_PRESET_LABELS[preset.value],
}));

export function automationSchedulePresetLabel(
  preset: typeof AUTOMATION_SCHEDULE_PRESETS[number]["value"],
): string {
  return AUTOMATION_SCHEDULE_PRESET_LABELS[preset] ?? "Schedule";
}

export function formatScheduleControlLabel(
  preset: AutomationSchedulePresetOrCustom,
  rrule: string,
): string {
  if (preset === "custom") return "Custom schedule";
  if (preset === "hourly") return "Hourly";
  return `${automationSchedulePresetLabel(preset)} at ${formatTimeLabel(timeForRrule(rrule))}`;
}

function formatTimeLabel(timeValue: string): string {
  const [hour = "09", minute = "00"] = timeValue.split(":");
  const date = new Date(2000, 0, 1, Number.parseInt(hour, 10), Number.parseInt(minute, 10));
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
