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

  // NEGATIVE CONTROL: counts come from the roster's count/liveCount/kind
  // only. `ActivityChipDescriptor` carries no tool-call/transcript status
  // field at all — the function cannot see a BashCommandCall's status flip
  // unless it actually changes the roster (count/liveCount). This mutates an
  // UNRELATED descriptive field (`label`, the only other field the type
  // carries) between two otherwise-identical snapshots and asserts the
  // counts don't move — a real invariance check against a real (if partial)
  // mutation, not a re-derivation from the same object.
  it("ignores descriptor fields other than kind/count/liveCount (label changes do not move the counts)", () => {
    const before = deriveBackgroundWorkRowCounts([
      chip({ kind: "terminals", count: 2, liveCount: 1, label: "2 terminals" }),
    ]);
    const after = deriveBackgroundWorkRowCounts([
      // Same kind/count/liveCount; only the incidental label text differs —
      // stand-in for state (like a tool call's status text) that rides
      // alongside the roster but isn't part of it.
      chip({ kind: "terminals", count: 2, liveCount: 1, label: "2 terminals (1 running)" }),
    ]);
    expect(after).toEqual(before);
  });
});
