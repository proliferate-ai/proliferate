import { describe, expect, it } from "vitest";
import {
  formatTranscriptActionTime,
  resolveAssistantTurnActionTime,
  resolveOptimisticPromptActionTime,
  resolveUserMessageActionTime,
} from "./transcript-action-time";

const NOW = new Date("2026-04-28T20:30:00Z");

describe("transcript action time", () => {
  it("formats same-day local times", () => {
    expect(formatTranscriptActionTime("2026-04-28T18:05:00Z", NOW)).toMatch(/^\d{1,2}:05 [AP]M$/);
  });

  it("formats other local dates with a month and day", () => {
    expect(formatTranscriptActionTime("2026-04-27T18:05:00Z", NOW)).toMatch(/^Apr \d{1,2}, \d{1,2}:05 [AP]M$/);
  });

  it("returns null for invalid dates", () => {
    expect(formatTranscriptActionTime("not-a-date", NOW)).toBeNull();
  });

  it("uses user message timestamps", () => {
    expect(resolveUserMessageActionTime({ timestamp: "2026-04-28T18:05:00Z" }, NOW)).toMatch(/:05 [AP]M$/);
  });

  it("uses queued optimistic prompt times", () => {
    expect(resolveOptimisticPromptActionTime({ queuedAt: "2026-04-28T18:06:00Z" }, NOW)).toMatch(/:06 [AP]M$/);
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
    })).toMatch(/:07 [AP]M$/);
  });
});
