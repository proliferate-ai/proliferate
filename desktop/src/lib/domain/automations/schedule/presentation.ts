import {
  AUTOMATION_SCHEDULE_PRESETS,
} from "@/config/automations";
import { timeForRrule, type AutomationSchedulePresetOrCustom } from "@/lib/domain/automations/schedule/schedule";

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
