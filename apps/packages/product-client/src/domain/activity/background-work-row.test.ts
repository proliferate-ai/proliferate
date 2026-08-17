import { describe, expect, it } from "vitest";
import type { ActivityChipDescriptor } from "./chips";
import { deriveActivityChips } from "./chips";
import { deriveBackgroundWorkRowCounts } from "./background-work-row";
import { isProcessRunning, type ActivityProcessWire } from "./process";
import type { ActivitySubagentWire } from "./subagent";

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

// R5 verification — Delivery Spec, Background Work Slice 1, acceptance line
// "wake turn renders the receipt and the roster + counts step down." These
// go through the real `deriveActivityChips` too (not a hand-built
// `ActivityChipDescriptor`), and reuse the exact filters
// `BackgroundWorkPane` renders the roster with (`isProcessRunning`), so a
// count and a roster row can never silently disagree — both are pure
// functions of the same `{ loops, processes, agents }` snapshot.
describe("R5 — roster + counts step down together, and only from the roster", () => {
  function process(overrides: Partial<ActivityProcessWire> = {}): ActivityProcessWire {
    return {
      id: "proc-1",
      command: "npm run dev",
      cwd: null,
      status: { status: "running" },
      pid: null,
      startedAt: "2026-08-17T00:00:00.000Z",
      endedAt: null,
      feed: null,
      ...overrides,
    };
  }

  function agent(overrides: Partial<ActivitySubagentWire> = {}): ActivitySubagentWire {
    return {
      id: "task-1",
      agentType: null,
      description: null,
      model: null,
      background: true,
      status: { status: "running" },
      usage: null,
      feed: null,
      ...overrides,
    };
  }

  it("a subagent finishing drops out of the roster and its count in the same step", () => {
    const before = { loops: [], processes: [], agents: [agent({ id: "a1" })] };
    const beforeCounts = deriveBackgroundWorkRowCounts(deriveActivityChips(before));
    expect(beforeCounts.runningCount).toBe(1);
    expect(before.agents.filter((a) => a.status.status === "running")).toHaveLength(1);

    // Native subagents leave the roster instantly on finish (locked design,
    // `chips.ts`) — there is no "completed" entry left behind to filter out,
    // the array itself shrinks.
    const after = { loops: [], processes: [], agents: [] };
    const afterCounts = deriveBackgroundWorkRowCounts(deriveActivityChips(after));
    expect(afterCounts.runningCount).toBe(0);
    expect(after.agents).toHaveLength(0);
  });

  it("a process finishing flips it to Closed scope — it stays in the roster, never leaves", () => {
    const running = process({ id: "proc-a", status: { status: "running" } });
    const before = { loops: [], processes: [running], agents: [] };
    const beforeCounts = deriveBackgroundWorkRowCounts(deriveActivityChips(before));
    expect(beforeCounts.runningCount).toBe(1);
    expect(beforeCounts.finishedCount).toBe(0);
    expect(before.processes.filter(isProcessRunning)).toHaveLength(1);
    expect(before.processes.filter((p) => !isProcessRunning(p))).toHaveLength(0);

    const exited = { ...running, status: { status: "exited" as const, exitCode: 0 }, endedAt: "2026-08-17T00:01:00.000Z" };
    const after = { loops: [], processes: [exited], agents: [] };
    const afterCounts = deriveBackgroundWorkRowCounts(deriveActivityChips(after));
    expect(afterCounts.runningCount).toBe(0);
    expect(afterCounts.finishedCount).toBe(1);
    // Same process id, still present — the Closed scope's `closedProcesses`
    // filter (`BackgroundWorkPane`) is what now picks it up, not a roster
    // removal like the subagent case above.
    expect(after.processes).toHaveLength(1);
    expect(after.processes.filter(isProcessRunning)).toHaveLength(0);
    expect(after.processes.filter((p) => !isProcessRunning(p))).toHaveLength(1);
    expect(after.processes[0]?.id).toBe("proc-a");
  });

  // NEGATIVE CONTROL — HANDOFF "Decisions that stuck": "`session/cancel`
  // does not stop background work, so the indicator survives cancellation
  // and keeps counting until the roster says otherwise." `session/cancel`
  // acts on the parent turn, never on this snapshot — there is no
  // tool-call/cancel field anywhere in `{ loops, processes, agents }` for
  // either derivation to read. Modeled here as the realistic shape of that
  // moment: the subagent/process the cancelled turn was waiting on are
  // themselves untouched (still running), so the exact same snapshot must
  // still count them as running — cancelling the turn is not, by itself,
  // a roster event.
  it("cancelling the parent turn does not move the count — only the roster finishing the work does", () => {
    const duringCancel = {
      loops: [],
      processes: [process({ id: "proc-a", status: { status: "running" } })],
      agents: [agent({ id: "a1", status: { status: "running" } })],
    };
    const counts = deriveBackgroundWorkRowCounts(deriveActivityChips(duringCancel));
    expect(counts.runningCount).toBe(2);

    // The cancelled turn ends, but the roster it left running is
    // unchanged — re-deriving from the identical snapshot must be
    // idempotent, not a fresh "0" just because a turn ended.
    const afterCancelledTurnEnds = deriveBackgroundWorkRowCounts(deriveActivityChips(duringCancel));
    expect(afterCancelledTurnEnds).toEqual(counts);

    // Only once the roster itself reports the work finished does the count
    // move.
    const finished = {
      loops: [],
      processes: [
        { ...duringCancel.processes[0]!, status: { status: "exited" as const, exitCode: 0 }, endedAt: "2026-08-17T00:02:00.000Z" },
      ],
      agents: [],
    };
    const finishedCounts = deriveBackgroundWorkRowCounts(deriveActivityChips(finished));
    expect(finishedCounts.runningCount).toBe(0);
    expect(finishedCounts.finishedCount).toBe(1);
  });
});
