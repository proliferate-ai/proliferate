import { describe, expect, it } from "vitest";
import type { ActivityProcessWire } from "./process";
import type { ActivitySubagentWire } from "./subagent";
import {
  deriveBackgroundWorkDirty,
  deriveLatestBackgroundWorkFinishSignal,
} from "./background-work-finish-signal";

function process(overrides: Partial<ActivityProcessWire>): ActivityProcessWire {
  return {
    id: "proc-1",
    command: "npm run build",
    cwd: null,
    status: { status: "running" },
    pid: null,
    startedAt: "2026-08-17T00:00:00.000Z",
    endedAt: null,
    feed: null,
    ...overrides,
  };
}

function subagent(overrides: Partial<ActivitySubagentWire>): ActivitySubagentWire {
  return {
    id: "agent-1",
    agentType: "task",
    description: "Explore ACP session lifecycle",
    model: null,
    background: true,
    status: { status: "running" },
    usage: null,
    feed: null,
    ...overrides,
  };
}

describe("deriveLatestBackgroundWorkFinishSignal", () => {
  it("returns null when nothing has finished", () => {
    const signal = deriveLatestBackgroundWorkFinishSignal({
      processes: [process({ status: { status: "running" } })],
      cachedFinishedSubagent: null,
    });
    expect(signal).toBeNull();
  });

  it("reads a process finish straight off the live roster (no cache needed)", () => {
    const exited = process({
      id: "proc-exited",
      status: { status: "exited", exitCode: 0 },
      endedAt: "2026-08-17T00:05:00.000Z",
    });
    const signal = deriveLatestBackgroundWorkFinishSignal({
      processes: [process({ status: { status: "running" } }), exited],
      cachedFinishedSubagent: null,
    });
    expect(signal).toEqual({
      kind: "process",
      process: exited,
      atMs: Date.parse("2026-08-17T00:05:00.000Z"),
    });
  });

  it("falls back to the cached subagent finish when no process has finished", () => {
    const cachedSubagent = subagent({ id: "agent-42" });
    const signal = deriveLatestBackgroundWorkFinishSignal({
      processes: [],
      cachedFinishedSubagent: { subagent: cachedSubagent, atMs: 1000 },
    });
    expect(signal).toEqual({ kind: "subagent", subagent: cachedSubagent, atMs: 1000 });
  });

  it("picks whichever of the two sources finished most recently", () => {
    const olderProcess = process({
      id: "proc-older",
      status: { status: "exited", exitCode: 0 },
      endedAt: "2026-08-17T00:00:00.000Z",
    });
    const newerProcess = process({
      id: "proc-newer",
      status: { status: "exited", exitCode: 0 },
      endedAt: "2026-08-17T00:10:00.000Z",
    });
    const cachedSubagent = subagent({ id: "agent-mid" });

    const subagentWins = deriveLatestBackgroundWorkFinishSignal({
      processes: [olderProcess],
      cachedFinishedSubagent: { subagent: cachedSubagent, atMs: Date.parse("2026-08-17T00:05:00.000Z") },
    });
    expect(subagentWins).toEqual({
      kind: "subagent",
      subagent: cachedSubagent,
      atMs: Date.parse("2026-08-17T00:05:00.000Z"),
    });

    const processWins = deriveLatestBackgroundWorkFinishSignal({
      processes: [newerProcess],
      cachedFinishedSubagent: { subagent: cachedSubagent, atMs: Date.parse("2026-08-17T00:05:00.000Z") },
    });
    expect(processWins).toEqual({
      kind: "process",
      process: newerProcess,
      atMs: Date.parse("2026-08-17T00:10:00.000Z"),
    });
  });

  it("ignores a process with a malformed endedAt rather than throwing", () => {
    const malformed = process({
      id: "proc-malformed",
      status: { status: "exited", exitCode: 0 },
      endedAt: "not-a-date",
    });
    const signal = deriveLatestBackgroundWorkFinishSignal({
      processes: [malformed],
      cachedFinishedSubagent: null,
    });
    expect(signal).toBeNull();
  });
});

describe("deriveBackgroundWorkDirty", () => {
  it("is never dirty when nothing has finished", () => {
    expect(deriveBackgroundWorkDirty({ latestFinishAtMs: null, lastViewedAtMs: null })).toBe(false);
    expect(deriveBackgroundWorkDirty({ latestFinishAtMs: null, lastViewedAtMs: 500 })).toBe(false);
  });

  it("is dirty the first time anything finishes, before the pane has ever been viewed", () => {
    expect(deriveBackgroundWorkDirty({ latestFinishAtMs: 100, lastViewedAtMs: null })).toBe(true);
  });

  it("is dirty only when the finish is newer than the last view", () => {
    expect(deriveBackgroundWorkDirty({ latestFinishAtMs: 100, lastViewedAtMs: 50 })).toBe(true);
    expect(deriveBackgroundWorkDirty({ latestFinishAtMs: 50, lastViewedAtMs: 100 })).toBe(false);
    expect(deriveBackgroundWorkDirty({ latestFinishAtMs: 100, lastViewedAtMs: 100 })).toBe(false);
  });

});

describe("negative control — counts never derive from tool-call status", () => {
  // Acceptance: "session/cancel during background work: indicator keeps
  // counting until the roster steps down (counts never derive from
  // tool-call status)." `session/cancel` never touches `ActivityProcessWire`
  // — the process keeps reporting `status: "running"` until the harness
  // itself reports it exited. Prove the signal (and therefore the dirty
  // dot) stays un-finished across a "cancel" that the roster never saw.
  it("a still-running process reports no finish signal even after its tool call would have been cancelled", () => {
    // The tool call itself is irrelevant to this derivation by
    // construction — it never appears as an input — but the roster state
    // a `session/cancel` leaves behind is exactly this: `status: "running"`
    // survives the cancel because the process keeps executing in the
    // background.
    const stillRunningAfterCancel = process({ id: "proc-cancelled-call", status: { status: "running" } });
    const signal = deriveLatestBackgroundWorkFinishSignal({
      processes: [stillRunningAfterCancel],
      cachedFinishedSubagent: null,
    });
    expect(signal).toBeNull();
    expect(deriveBackgroundWorkDirty({ latestFinishAtMs: signal?.atMs ?? null, lastViewedAtMs: null }))
      .toBe(false);
  });

  it("only flips once the roster itself reports the process exited, independent of when the call was cancelled", () => {
    const nowExited = process({
      id: "proc-cancelled-call",
      status: { status: "exited", exitCode: 0 },
      endedAt: "2026-08-17T00:05:00.000Z",
    });
    const signal = deriveLatestBackgroundWorkFinishSignal({
      processes: [nowExited],
      cachedFinishedSubagent: null,
    });
    expect(signal?.kind).toBe("process");
    expect(deriveBackgroundWorkDirty({ latestFinishAtMs: signal?.atMs ?? null, lastViewedAtMs: null }))
      .toBe(true);
  });
});
