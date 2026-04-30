import { AUTOMATION_SCHEDULE_PRESET_OPTIONS } from "@/config/automations";

export type AutomationSchedulePreset = typeof AUTOMATION_SCHEDULE_PRESET_OPTIONS[number]["value"];
export type AutomationSchedulePresetOrCustom = AutomationSchedulePreset | "custom";

const DEFAULT_AUTOMATION_TIME = "09:00";
const WEEKDAY_RRULE_DAYS = "MO,TU,WE,TH,FR";
const WEEKEND_RRULE_DAYS = "SA,SU";

const COMMON_AUTOMATION_TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "America/Los_Angeles", label: "Pacific Time" },
  { value: "America/Denver", label: "Mountain Time" },
  { value: "America/Chicago", label: "Central Time" },
  { value: "America/New_York", label: "Eastern Time" },
  { value: "America/Phoenix", label: "Arizona Time" },
  { value: "America/Anchorage", label: "Alaska Time" },
  { value: "Pacific/Honolulu", label: "Hawaii Time" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Asia/Kolkata", label: "India" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
] as const;

export function defaultAutomationTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function rruleForPreset(preset: AutomationSchedulePreset): string {
  return AUTOMATION_SCHEDULE_PRESET_OPTIONS.find((option) => option.value === preset)?.rrule
    ?? AUTOMATION_SCHEDULE_PRESET_OPTIONS[0].rrule;
}

export function rruleForPresetAtTime(
  preset: AutomationSchedulePreset,
  timeValue: string = DEFAULT_AUTOMATION_TIME,
): string {
  if (preset === "hourly") {
    return rruleForPreset("hourly");
  }
  const { hour, minute } = parseAutomationTime(timeValue) ?? parseAutomationTime(DEFAULT_AUTOMATION_TIME)!;
  const timeClause = `BYHOUR=${hour};BYMINUTE=${minute}`;
  if (preset === "weekdays") {
    return `RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=${WEEKDAY_RRULE_DAYS};${timeClause}`;
  }
  if (preset === "weekends") {
    return `RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=${WEEKEND_RRULE_DAYS};${timeClause}`;
  }
  return `RRULE:FREQ=DAILY;INTERVAL=1;${timeClause}`;
}

export function presetForRrule(rrule: string): AutomationSchedulePresetOrCustom {
  const parts = parseRruleParts(rrule);
  if (!parts) return "custom";
  const interval = parts.INTERVAL ?? "1";
  if (parts.FREQ === "HOURLY" && interval === "1" && !parts.BYDAY && !parts.BYHOUR) {
    return "hourly";
  }
  if (parts.FREQ !== "DAILY" || interval !== "1") {
    return "custom";
  }
  if (!parts.BYDAY) {
    return "daily";
  }
  if (parts.BYDAY === WEEKDAY_RRULE_DAYS) {
    return "weekdays";
  }
  if (parts.BYDAY === WEEKEND_RRULE_DAYS) {
    return "weekends";
  }
  return "custom";
}

export function timeForRrule(rrule: string): string {
  const parts = parseRruleParts(rrule);
  const hour = Number.parseInt(parts?.BYHOUR ?? "", 10);
  const minute = Number.parseInt(parts?.BYMINUTE ?? "", 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return DEFAULT_AUTOMATION_TIME;
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return DEFAULT_AUTOMATION_TIME;
  }
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

export function schedulePresetAcceptsTime(preset: AutomationSchedulePresetOrCustom): preset is Exclude<AutomationSchedulePreset, "hourly"> {
  return preset === "daily" || preset === "weekdays" || preset === "weekends";
}

export function formatScheduleControlLabel(
  preset: AutomationSchedulePresetOrCustom,
  rrule: string,
): string {
  if (preset === "custom") return "Custom schedule";
  if (preset === "hourly") return "Hourly";
  const label = AUTOMATION_SCHEDULE_PRESET_OPTIONS.find((option) => option.value === preset)?.label
    ?? "Schedule";
  return `${label} at ${formatTimeLabel(timeForRrule(rrule))}`;
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

export interface AutomationTimezoneOption {
  value: string;
  label: string;
}

export function automationTimezoneOptions(
  currentTimezone: string,
  localTimezone = defaultAutomationTimezone(),
): AutomationTimezoneOption[] {
  const options: AutomationTimezoneOption[] = [];
  const addOption = (value: string, label: string) => {
    if (!value || options.some((option) => option.value === value)) return;
    options.push({ value, label });
  };

  addOption(localTimezone, `Local (${localTimezone})`);
  if (currentTimezone && currentTimezone !== localTimezone) {
    addOption(currentTimezone, currentTimezone);
  }
  for (const option of COMMON_AUTOMATION_TIMEZONES) {
    addOption(option.value, `${option.label} (${option.value})`);
  }
  return options;
}

function parseAutomationTime(timeValue: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeValue.trim());
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

function parseRruleParts(rrule: string): Record<string, string> | null {
  const line = rrule.trim().toUpperCase().replace(/^RRULE:/, "");
  if (!line) return null;
  const parts: Record<string, string> = {};
  for (const segment of line.split(";")) {
    const [key, ...valueParts] = segment.split("=");
    const value = valueParts.join("=");
    if (!key || !value) return null;
    parts[key] = value;
  }
  return parts;
}

function formatTimeLabel(timeValue: string): string {
  const parsed = parseAutomationTime(timeValue) ?? parseAutomationTime(DEFAULT_AUTOMATION_TIME)!;
  const date = new Date(2000, 0, 1, parsed.hour, parsed.minute);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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
