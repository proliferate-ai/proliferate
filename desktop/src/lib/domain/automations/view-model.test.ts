import { describe, expect, it } from "vitest";
import type {
  AutomationRecord,
  AutomationRunRecord,
} from "./records";
import {
  automationRunStatusLabel,
  buildAutomationRowViewModel,
  formatAutomationNextRunPlain,
} from "./view-model";
import { validateAutomationTimezone } from "./schedule";

function automation(overrides: Partial<AutomationRecord> = {}): AutomationRecord {
  return {
    id: "automation-1",
    gitOwner: "proliferate-ai",
    gitRepoName: "proliferate",
    title: "Daily check",
    schedule: {
      rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      timezone: "UTC",
      summary: "Daily at 09:00 in UTC",
      nextRunAt: "2026-04-20T09:00:00Z",
    },
    executionTarget: "cloud",
    enabled: true,
    ...overrides,
  };
}

function run(overrides: Partial<AutomationRunRecord> = {}): AutomationRunRecord {
  return {
    triggerKind: "manual",
    scheduledFor: null,
    executionTarget: "cloud",
    status: "queued",
    lastErrorMessage: null,
    createdAt: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

describe("buildAutomationRowViewModel", () => {
  it("builds repo and enabled state copy", () => {
    const view = buildAutomationRowViewModel(automation());

    expect(view.repoLabel).toBe("proliferate-ai/proliferate");
    expect(view.statusLabel).toBe("Enabled");
    expect(view.executionLabel).toBe("Cloud");
  });

  it("marks paused automations without implying a next run", () => {
    const view = buildAutomationRowViewModel(automation({
      enabled: false,
      schedule: {
        rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        timezone: "UTC",
        summary: "Daily at 09:00 in UTC",
        nextRunAt: null,
      },
    }));

    expect(view.statusLabel).toBe("Paused");
    expect(view.nextRunLabel).toBe("Paused");
  });
});

describe("formatAutomationNextRunPlain", () => {
  const now = new Date("2026-04-20T08:00:00Z");

  it("uses relative copy for near-future runs", () => {
    expect(formatAutomationNextRunPlain("2026-04-20T08:30:00Z", "UTC", now)).toBe(
      "in 30 minutes",
    );
    expect(formatAutomationNextRunPlain("2026-04-20T09:00:00Z", "UTC", now)).toBe(
      "in an hour",
    );
  });

  it("uses plain calendar copy for later runs", () => {
    expect(formatAutomationNextRunPlain("2026-04-21T09:00:00Z", "UTC", now)).toBe(
      "tomorrow at 9:00 AM",
    );
    expect(formatAutomationNextRunPlain("2026-04-24T09:00:00Z", "UTC", now)).toBe(
      "Friday at 9:00 AM",
    );
  });
});

describe("validateAutomationTimezone", () => {
  it("accepts UTC even when Intl.supportedValuesOf omits it", () => {
    expect(validateAutomationTimezone("UTC")).toBeNull();
  });
});

describe("automationRunStatusLabel", () => {
  it("uses executor-unavailable copy for cloud and local queued runs", () => {
    expect(automationRunStatusLabel(run({ executionTarget: "cloud" }))).toBe(
      "Queued",
    );
    expect(automationRunStatusLabel(run({ executionTarget: "local" }))).toBe(
      "Queued, local executor not available yet",
    );
  });

  it("uses cancelled copy for cancelled runs", () => {
    expect(automationRunStatusLabel(run({ status: "cancelled" }))).toBe("Cancelled");
  });

  it("uses handoff copy for dispatched cloud runs", () => {
    expect(automationRunStatusLabel(run({ status: "dispatched" }))).toBe("Session started");
  });

  it("uses local worktree copy for local executor setup states", () => {
    expect(automationRunStatusLabel(run({
      executionTarget: "local",
      status: "creating_workspace",
    }))).toBe("Creating local worktree");
    expect(automationRunStatusLabel(run({
      executionTarget: "local",
      status: "provisioning_workspace",
    }))).toBe("Preparing worktree");
  });

  it("uses sanitized failure copy for failed runs", () => {
    expect(automationRunStatusLabel(run({
      status: "failed",
      lastErrorMessage: "The requested cloud agent is not ready in the runtime.",
    }))).toBe("The requested cloud agent is not ready in the runtime.");
  });

  it("compacts multiline and long failure copy", () => {
    expect(automationRunStatusLabel(run({
      status: "failed",
      lastErrorMessage: `First line\nSecond line`,
    }))).toBe("First line");

    const message = "x".repeat(160);
    expect(automationRunStatusLabel(run({
      status: "failed",
      lastErrorMessage: message,
    }))).toHaveLength(140);
  });

  it("keeps unknown statuses visible", () => {
    expect(automationRunStatusLabel(run({
      status: "bogus" as AutomationRunRecord["status"],
    }))).toBe("Unknown status: bogus");
  });
});
