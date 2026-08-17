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
      lastViewedAtMs: null,
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
      lastViewedAtMs: null,
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
      cachedFinishedSubagent: { subagent: cachedSubagent, detectedAtMs: 1000 },
      lastViewedAtMs: null,
    });
    expect(signal).toEqual({ kind: "subagent", subagent: cachedSubagent, atMs: 1000 });
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
      lastViewedAtMs: null,
    });
    expect(signal).toBeNull();
  });

  // MINOR #4 (R5 review round 2) — non-suppression regression: a still-
  // running process sitting alongside a just-finished subagent must not
  // suppress the subagent's signal. Pinned by a real snapshot, not by
  // reading the code.
  it("does not suppress a finished subagent's signal just because another process is still running", () => {
    const stillRunning = process({ id: "proc-running", status: { status: "running" } });
    const cachedSubagent = subagent({ id: "agent-done", status: { status: "completed", summary: null } });
    const signal = deriveLatestBackgroundWorkFinishSignal({
      processes: [stillRunning],
      cachedFinishedSubagent: { subagent: cachedSubagent, detectedAtMs: 5000 },
      lastViewedAtMs: null,
    });
    expect(signal).toEqual({ kind: "subagent", subagent: cachedSubagent, atMs: 5000 });
  });

  describe("deterministic tiebreak (R5 review round 2 — MAJOR)", () => {
    // A cached subagent's `detectedAtMs` is only when THIS client noticed
    // the disappearance, not the subagent's real finish time — it can lag
    // arbitrarily behind a process's real, server-stamped `endedAt`. The
    // rule: an unseen process ALWAYS wins over an unseen subagent
    // detection, even when the raw detection timestamp is numerically
    // later, because trusting the later-but-unknown timestamp is exactly
    // the wrong-name bug this tiebreak exists to prevent.
    it("prefers an unseen process over an unseen subagent detection even when the detection's raw timestamp is later", () => {
      const process1 = process({
        id: "proc-real",
        status: { status: "exited", exitCode: 0 },
        endedAt: "2026-08-17T00:05:00.000Z", // real: 00:05
      });
      const cachedSubagent = subagent({ id: "agent-late-detect" });
      const lastViewedAtMs = Date.parse("2026-08-17T00:00:00.000Z"); // both are unseen

      const signal = deriveLatestBackgroundWorkFinishSignal({
        processes: [process1],
        // Detected at 00:20 — numerically LATER than the process's real
        // 00:05 endedAt — yet the process must still win.
        cachedFinishedSubagent: {
          subagent: cachedSubagent,
          detectedAtMs: Date.parse("2026-08-17T00:20:00.000Z"),
        },
        lastViewedAtMs,
      });

      expect(signal).toEqual({
        kind: "process",
        process: process1,
        atMs: Date.parse("2026-08-17T00:05:00.000Z"),
      });
    });

    it("falls back to the unseen subagent detection only when no process is unseen", () => {
      const alreadySeenProcess = process({
        id: "proc-seen",
        status: { status: "exited", exitCode: 0 },
        endedAt: "2026-08-17T00:00:00.000Z", // before lastViewedAtMs — seen already
      });
      const cachedSubagent = subagent({ id: "agent-unseen" });
      const lastViewedAtMs = Date.parse("2026-08-17T00:10:00.000Z");

      const signal = deriveLatestBackgroundWorkFinishSignal({
        processes: [alreadySeenProcess],
        cachedFinishedSubagent: {
          subagent: cachedSubagent,
          detectedAtMs: Date.parse("2026-08-17T00:20:00.000Z"), // unseen
        },
        lastViewedAtMs,
      });

      expect(signal).toEqual({
        kind: "subagent",
        subagent: cachedSubagent,
        atMs: Date.parse("2026-08-17T00:20:00.000Z"),
      });
    });

    it("prefers the real process time over the unknown subagent detection even when NEITHER is unseen (inert case, hidden by dirty=false)", () => {
      const seenProcess = process({
        id: "proc-seen",
        status: { status: "exited", exitCode: 0 },
        endedAt: "2026-08-17T00:00:00.000Z",
      });
      const cachedSubagent = subagent({ id: "agent-seen" });
      const lastViewedAtMs = Date.parse("2026-08-17T00:30:00.000Z"); // after both

      const signal = deriveLatestBackgroundWorkFinishSignal({
        processes: [seenProcess],
        cachedFinishedSubagent: {
          subagent: cachedSubagent,
          detectedAtMs: Date.parse("2026-08-17T00:10:00.000Z"),
        },
        lastViewedAtMs,
      });

      expect(signal?.kind).toBe("process");
      // Confirm it really is inert: nothing here is dirty, so no caller
      // would ever render this signal regardless of which kind it picked.
      expect(deriveBackgroundWorkDirty({ latestFinishAtMs: signal?.atMs ?? null, lastViewedAtMs }))
        .toBe(false);
    });
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
      lastViewedAtMs: null,
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
      lastViewedAtMs: null,
    });
    expect(signal?.kind).toBe("process");
    expect(deriveBackgroundWorkDirty({ latestFinishAtMs: signal?.atMs ?? null, lastViewedAtMs: null }))
      .toBe(true);
  });
});
