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
    cancelledAt: null,
    lastError: null,
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
  it("uses executor-unavailable copy for cloud and local queued runs", () => {
    expect(automationRunStatusLabel(run({ executionTarget: "cloud" }))).toBe(
      "Queued, cloud executor not available yet",
    );
    expect(automationRunStatusLabel(run({ executionTarget: "local" }))).toBe(
      "Queued, local executor not available yet",
    );
  });

  it("uses cancelled copy for cancelled runs", () => {
    expect(automationRunStatusLabel(run({ status: "cancelled" }))).toBe("Cancelled");
  });
});
