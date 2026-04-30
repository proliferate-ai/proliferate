import { AUTOMATION_SCHEDULE_PRESET_OPTIONS } from "@/config/automations";

export type AutomationSchedulePreset = typeof AUTOMATION_SCHEDULE_PRESET_OPTIONS[number]["value"];

export function defaultAutomationTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function rruleForPreset(preset: AutomationSchedulePreset): string {
  return AUTOMATION_SCHEDULE_PRESET_OPTIONS.find((option) => option.value === preset)?.rrule
    ?? AUTOMATION_SCHEDULE_PRESET_OPTIONS[0].rrule;
}

export function presetForRrule(rrule: string): AutomationSchedulePreset | "custom" {
  const match = AUTOMATION_SCHEDULE_PRESET_OPTIONS.find((option) => option.rrule === rrule);
  return match?.value ?? "custom";
}

export function validateAutomationTimezone(timezone: string): string | null {
  const trimmed = timezone.trim();
  if (!trimmed) return "Timezone is required.";
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: trimmed });
  } catch {
    return "Use a valid IANA timezone, such as America/Los_Angeles.";
  }
  return null;
}

export function validateAutomationRrule(rrule: string): string | null {
  const normalized = rrule.trim().toUpperCase();
  if (!normalized) return "RRULE is required.";
  if (!normalized.startsWith("RRULE:")) return "RRULE must start with RRULE:.";
  if (!normalized.includes("FREQ=")) return "RRULE must include FREQ.";
  const unsupportedTokens = ["DTSTART", "RDATE", "EXDATE", "COUNT=", "UNTIL=", "BYSECOND="];
  if (unsupportedTokens.some((token) => normalized.includes(token))) {
    return "This RRULE uses an option that automations do not support yet.";
  }
  return null;
}

export function formatAutomationTimestamp(value: string | null, timezone?: string | null): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone ?? undefined,
  }).format(date);
}
