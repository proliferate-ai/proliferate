export const AUTOMATION_EXECUTION_TARGET_VALUES = ["cloud", "local"] as const;

export const AUTOMATION_SUPPORTED_AGENT_KINDS = ["claude", "codex", "gemini"] as const;

export type AutomationSupportedAgentKind = typeof AUTOMATION_SUPPORTED_AGENT_KINDS[number];

export const AUTOMATION_REASONING_EFFORT_VALUES = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export const AUTOMATION_SCHEDULE_PRESETS = [
  {
    value: "hourly",
    rrule: "RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
  },
  {
    value: "daily",
    rrule: "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0",
  },
  {
    value: "weekdays",
    rrule: "RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
  },
  {
    value: "weekends",
    rrule: "RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=SA,SU;BYHOUR=9;BYMINUTE=0",
  },
] as const;
