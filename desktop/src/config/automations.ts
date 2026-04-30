export const AUTOMATION_EXECUTION_TARGET_OPTIONS = [
  { value: "cloud", label: "Cloud" },
  { value: "local", label: "Local" },
] as const;

export const AUTOMATION_AGENT_KIND_OPTIONS = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini" },
] as const;

export const AUTOMATION_REASONING_EFFORT_OPTIONS = [
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
] as const;

export const AUTOMATION_SCHEDULE_PRESET_OPTIONS = [
  {
    value: "hourly",
    label: "Hourly",
    rrule: "RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
  },
  {
    value: "daily",
    label: "Daily",
    rrule: "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0",
  },
  {
    value: "weekdays",
    label: "Weekdays",
    rrule: "RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
  },
  {
    value: "weekends",
    label: "Weekends",
    rrule: "RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=SA,SU;BYHOUR=9;BYMINUTE=0",
  },
] as const;

export const AUTOMATION_RUN_COPY = {
  cloudQueued: "Queued, cloud executor not available yet",
  localQueued: "Queued, local executor not available yet",
  cancelled: "Cancelled",
} as const;

export const AUTOMATION_PREEXECUTOR_COPY = {
  pageDescription: "Definitions and queued runs are live. Executors land in the next PR.",
  emptyState: "Create an automation to queue scheduled runs. Execution is not enabled yet.",
  modalDescription: "Automation execution will be enabled by the executor PR.",
} as const;

function envFlagEnabled(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return defaultValue;
  return !["0", "false", "off", "no"].includes(normalized);
}

export function automationsUiEnabled(): boolean {
  // Intentional PR-1 build-time UI flag; the backend still enforces AUTOMATIONS_ENABLED at runtime.
  return envFlagEnabled(import.meta.env.VITE_PROLIFERATE_AUTOMATIONS_ENABLED, false);
}
