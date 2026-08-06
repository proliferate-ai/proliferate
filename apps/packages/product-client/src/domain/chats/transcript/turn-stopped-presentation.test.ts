import { describe, expect, it } from "vitest";
import type { TurnRecord } from "@anyharness/sdk";
import { resolveTurnStoppedNotice } from "./turn-stopped-presentation";

function turn(overrides: Partial<TurnRecord>): TurnRecord {
  return {
    turnId: "turn-1",
    itemOrder: [],
    startedAt: "2026-07-01T12:00:00.000Z",
    completedAt: "2026-07-01T12:00:23.000Z",
    stopReason: "cancelled",
    fileBadges: [],
    ...overrides,
  };
}

describe("resolveTurnStoppedNotice", () => {
  it("formats seconds for cancelled turns", () => {
    expect(resolveTurnStoppedNotice(turn({}))).toBe("You stopped after 23s");
  });

  it("formats minutes past 60s", () => {
    expect(
      resolveTurnStoppedNotice(turn({ completedAt: "2026-07-01T12:01:30.000Z" })),
    ).toBe("You stopped after 1m 30s");
  });

  it("returns null for non-cancelled turns", () => {
    expect(resolveTurnStoppedNotice(turn({ stopReason: "end_turn" }))).toBeNull();
    expect(resolveTurnStoppedNotice(turn({ stopReason: null }))).toBeNull();
  });

  it("returns null while the turn is still running", () => {
    expect(resolveTurnStoppedNotice(turn({ completedAt: null }))).toBeNull();
  });

  it("degrades to a plain notice on bad timestamps", () => {
    expect(resolveTurnStoppedNotice(turn({ startedAt: "bogus" }))).toBe("You stopped");
  });
});
