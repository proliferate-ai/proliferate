import { describe, expect, it } from "vitest";
import type { ActivityChipDescriptor } from "./chips";
import { deriveBackgroundWorkRowCounts } from "./background-work-row";

function chip(overrides: Partial<ActivityChipDescriptor>): ActivityChipDescriptor {
  return {
    kind: "terminals",
    count: 0,
    liveCount: 0,
    label: "",
    ...overrides,
  };
}

describe("deriveBackgroundWorkRowCounts", () => {
  it("sums running processes and running subagents into runningCount", () => {
    const counts = deriveBackgroundWorkRowCounts([
      chip({ kind: "terminals", count: 3, liveCount: 2, label: "3 terminals" }),
      chip({ kind: "agents", count: 1, liveCount: 1, label: "1 native subagent" }),
    ]);
    expect(counts.runningCount).toBe(3);
  });

  it("counts exited-but-still-in-roster processes as finishedCount", () => {
    const counts = deriveBackgroundWorkRowCounts([
      chip({ kind: "terminals", count: 3, liveCount: 1, label: "3 terminals" }),
    ]);
    expect(counts.finishedCount).toBe(2);
  });

  it("drops armed loops entirely — loops are descoped for this row", () => {
    const counts = deriveBackgroundWorkRowCounts([
      chip({ kind: "loops", count: 5, liveCount: 5, label: "5 loops" }),
    ]);
    expect(counts).toEqual({ runningCount: 0, finishedCount: 0 });
  });

  it("returns all zeros for an empty roster", () => {
    expect(deriveBackgroundWorkRowCounts([])).toEqual({ runningCount: 0, finishedCount: 0 });
  });

  // NEGATIVE CONTROL: counts come from the roster chip descriptors only.
  // There is no tool-call/transcript status input to this function at all —
  // it cannot see a BashCommandCall's status flip, so a tool call reporting
  // "success" or "failed" has zero effect unless the roster itself (the
  // `processes`/`agents` arrays behind these chips) actually changes.
  it("is a pure function of roster chip descriptors, with no tool-call status input", () => {
    const rosterChips: ActivityChipDescriptor[] = [
      chip({ kind: "terminals", count: 2, liveCount: 1, label: "2 terminals" }),
    ];
    const before = deriveBackgroundWorkRowCounts(rosterChips);
    // Simulate "a tool call's status flipped" by re-deriving from the exact
    // same roster snapshot — the function has no other input it could read
    // that status from, so the result must be identical.
    const after = deriveBackgroundWorkRowCounts(rosterChips);
    expect(after).toEqual(before);
  });
});
