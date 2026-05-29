import { describe, expect, it } from "vitest";
import {
  automationTimezoneOptions,
  presetForRrule,
  rruleForPresetAtTime,
  timeForRrule,
} from "./schedule";

describe("automation schedule helpers", () => {
  it("builds time-specific daily presets", () => {
    expect(rruleForPresetAtTime("daily", "14:30")).toBe(
      "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=14;BYMINUTE=30",
    );
    expect(rruleForPresetAtTime("weekdays", "08:05")).toBe(
      "RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=5",
    );
    expect(rruleForPresetAtTime("weekends", "19:45")).toBe(
      "RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=SA,SU;BYHOUR=19;BYMINUTE=45",
    );
  });

  it("keeps hourly as a simple hourly schedule", () => {
    expect(rruleForPresetAtTime("hourly", "14:30")).toBe(
      "RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
    );
  });

  it("recognizes supported preset rrules even when their time changes", () => {
    expect(presetForRrule("RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=14;BYMINUTE=30")).toBe("daily");
    expect(presetForRrule("RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYHOUR=8;BYMINUTE=5")).toBe("weekdays");
    expect(presetForRrule("RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=SA,SU;BYHOUR=19;BYMINUTE=45")).toBe("weekends");
    expect(presetForRrule("RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=MO,WE;BYHOUR=9;BYMINUTE=0")).toBe("custom");
  });

  it("extracts preset times from rrules", () => {
    expect(timeForRrule("RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=14;BYMINUTE=30")).toBe("14:30");
    expect(timeForRrule("RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=7;BYMINUTE=5")).toBe("07:05");
  });

  it("builds timezone options with local and saved zones preserved", () => {
    expect(automationTimezoneOptions(
      "America/Argentina/Buenos_Aires",
      "America/Los_Angeles",
    ).slice(0, 3)).toEqual([
      { value: "America/Los_Angeles", label: "Local (America/Los_Angeles)" },
      { value: "America/Argentina/Buenos_Aires", label: "America/Argentina/Buenos_Aires" },
      { value: "UTC", label: "UTC (UTC)" },
    ]);
  });
});
