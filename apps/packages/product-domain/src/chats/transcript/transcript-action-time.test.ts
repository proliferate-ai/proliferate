import { describe, expect, it } from "vitest";
import {
  formatTranscriptActionTime,
  resolveAssistantTurnActionTime,
  resolveCompletedWorkHistoryLabel,
  resolveOptimisticPromptActionTime,
  resolveUserMessageActionTime,
} from "./transcript-action-time";

const NOW = new Date("2026-04-28T20:30:00Z");

describe("transcript action time", () => {
  it("formats same-day local times", () => {
    expect(formatTranscriptActionTime("2026-04-28T18:05:00Z", NOW)).toMatch(/^\d{1,2}:05 [ap]m$/);
  });

  it("formats other local dates with a month and day", () => {
    expect(formatTranscriptActionTime("2026-04-27T18:05:00Z", NOW)).toMatch(/^Apr \d{1,2} . \d{1,2}:05 [ap]m$/);
  });

  it("returns null for invalid dates", () => {
    expect(formatTranscriptActionTime("not-a-date", NOW)).toBeNull();
  });

  it("uses user message timestamps", () => {
    expect(resolveUserMessageActionTime({ timestamp: "2026-04-28T18:05:00Z" }, NOW)).toMatch(/:05 [ap]m$/);
  });

  it("uses queued optimistic prompt times", () => {
    expect(resolveOptimisticPromptActionTime({ queuedAt: "2026-04-28T18:06:00Z" }, NOW)).toMatch(/:06 [ap]m$/);
  });

  it("prefers assistant item completion before item timestamp and turn time", () => {
    expect(resolveAssistantTurnActionTime({
      assistantItem: {
        completedAt: "2026-04-28T18:07:00Z",
        timestamp: "2026-04-28T18:06:00Z",
      },
      turn: {
        completedAt: "2026-04-28T18:05:00Z",
        startedAt: "2026-04-28T18:04:00Z",
      },
      now: NOW,
    })).toMatch(/:07 [ap]m$/);
  });

  it("labels completed work history with the elapsed turn duration", () => {
    expect(resolveCompletedWorkHistoryLabel({
      startedAt: "2026-04-28T18:00:00Z",
      completedAt: "2026-04-28T18:13:25Z",
    })).toBe("Worked for 13m 25s");

    expect(resolveCompletedWorkHistoryLabel({
      startedAt: "2026-04-28T18:00:00Z",
      completedAt: "2026-04-28T19:04:25Z",
    })).toBe("Worked for 1h 4m");
  });

  it("falls back safely when completed work history has no valid duration", () => {
    expect(resolveCompletedWorkHistoryLabel({
      startedAt: "2026-04-28T18:00:00Z",
      completedAt: null,
    })).toBe("Work history");

    expect(resolveCompletedWorkHistoryLabel({
      startedAt: "not-a-date",
      completedAt: "2026-04-28T18:01:00Z",
    })).toBe("Work history");

    expect(resolveCompletedWorkHistoryLabel({
      startedAt: "2026-04-28T18:01:00Z",
      completedAt: "2026-04-28T18:00:00Z",
    })).toBe("Work history");
  });
});
