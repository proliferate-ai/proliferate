import { describe, expect, it } from "vitest";
import type {
  AutomationResponse,
  AutomationRunResponse,
} from "@/lib/integrations/cloud/client";
import {
  automationRunStatusLabel,
  buildAutomationRowViewModel,
} from "./view-model";
import { validateAutomationTimezone } from "./schedule";

function automation(overrides: Partial<AutomationResponse> = {}): AutomationResponse {
  return {
    id: "automation-1",
    gitOwner: "proliferate-ai",
    gitRepoName: "proliferate",
    title: "Daily check",
    prompt: "Check the repo.",
    schedule: {
      rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      timezone: "UTC",
      summary: "Daily at 09:00 in UTC",
      nextRunAt: "2026-04-20T09:00:00Z",
    },
    executionTarget: "cloud",
    agentKind: null,
    modelId: null,
    modeId: null,
    reasoningEffort: null,
    enabled: true,
    pausedAt: null,
    lastScheduledAt: null,
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

function run(overrides: Partial<AutomationRunResponse> = {}): AutomationRunResponse {
  return {
    id: "run-1",
    automationId: "automation-1",
    triggerKind: "manual",
    scheduledFor: null,
    executionTarget: "cloud",
    status: "queued",
    titleSnapshot: "Daily check",
    agentKindSnapshot: "codex",
    modelIdSnapshot: null,
    modeIdSnapshot: null,
    reasoningEffortSnapshot: null,
    claimExpiresAt: null,
    dispatchStartedAt: null,
    dispatchedAt: null,
    failedAt: null,
    cloudWorkspaceId: null,
    anyharnessWorkspaceId: null,
    anyharnessSessionId: null,
    cancelledAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
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
      pausedAt: "2026-04-20T01:00:00Z",
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

describe("validateAutomationTimezone", () => {
  it("accepts UTC even when Intl.supportedValuesOf omits it", () => {
    expect(validateAutomationTimezone("UTC")).toBeNull();
  });
});

describe("automationRunStatusLabel", () => {
  it("uses local executor-unavailable copy and plain Queued for cloud", () => {
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

  it("uses sanitized failure copy for failed runs", () => {
    expect(automationRunStatusLabel(run({
      status: "failed",
      lastErrorMessage: "The requested cloud agent is not ready in the runtime.",
    }))).toBe("The requested cloud agent is not ready in the runtime.");
  });

  it("compacts multiline failure copy", () => {
    const message = `${"x".repeat(180)}\nsecond line`;

    expect(automationRunStatusLabel(run({
      status: "failed",
      lastErrorMessage: message,
    }))).toBe(`${"x".repeat(139)}…`);
  });

  it("surfaces unknown server statuses instead of treating them as queued", () => {
    expect(automationRunStatusLabel(run({
      status: "retrying" as AutomationRunResponse["status"],
    }))).toBe("Unknown status: retrying");
  });
});
