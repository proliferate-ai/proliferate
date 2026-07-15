import { describe, expect, it } from "vitest";
import type {
  ActivityProcess,
  ActivitySubagent,
  Loop,
  SessionActivity,
  SessionEvent,
} from "@anyharness/sdk";
import { foldActivityEvent } from "@/lib/domain/sessions/activity-fold";

function loop(overrides?: Partial<Loop>): Loop {
  return {
    loopId: "loop-1",
    prompt: "ping",
    schedule: { kind: "interval", expr: "5m" },
    recurring: true,
    status: "active",
    native: true,
    fireCount: 0,
    updatedAtMs: 1,
    ...overrides,
  };
}

function process(overrides?: Partial<ActivityProcess>): ActivityProcess {
  return {
    id: "proc-1",
    command: "sleep 30",
    status: { status: "running" },
    startedAt: "2026-07-03T00:00:00Z",
    ...overrides,
  };
}

function subagent(overrides?: Partial<ActivitySubagent>): ActivitySubagent {
  return {
    id: "agent-1",
    background: true,
    status: { status: "running" },
    ...overrides,
  };
}

describe("foldActivityEvent", () => {
  it("returns undefined for non-activity events", () => {
    expect(foldActivityEvent(null, { type: "usage_update" } as SessionEvent)).toBeUndefined();
  });

  it("creates the aggregate on the first loop upsert", () => {
    const next = foldActivityEvent(null, { type: "loop_upserted", loop: loop() } as SessionEvent);
    expect(next?.loops).toEqual([loop()]);
  });

  it("upserts a loop by loopId rather than duplicating", () => {
    const first = foldActivityEvent(null, {
      type: "loop_upserted",
      loop: loop(),
    } as SessionEvent) as SessionActivity;
    const edited = loop({ prompt: "pong", updatedAtMs: 2 });
    const next = foldActivityEvent(first, {
      type: "loop_upserted",
      loop: edited,
    } as SessionEvent);
    expect(next?.loops).toEqual([edited]);
  });

  it("updates fire bookkeeping on loop_fired", () => {
    const first = foldActivityEvent(null, {
      type: "loop_upserted",
      loop: loop(),
    } as SessionEvent) as SessionActivity;
    const fired = loop({ fireCount: 1, lastFiredAtMs: 999 });
    const next = foldActivityEvent(first, {
      type: "loop_fired",
      loop: fired,
      firedAtMs: 999,
    } as SessionEvent);
    expect(next?.loops?.[0]?.fireCount).toBe(1);
  });

  it("collapses to null when loop_removed empties the aggregate", () => {
    const first = foldActivityEvent(null, {
      type: "loop_upserted",
      loop: loop(),
    } as SessionEvent) as SessionActivity;
    const next = foldActivityEvent(first, {
      type: "loop_removed",
      loopId: "loop-1",
    } as SessionEvent);
    expect(next).toBeNull();
  });

  it("keeps other rosters when one loop is removed", () => {
    let state = foldActivityEvent(null, {
      type: "loop_upserted",
      loop: loop(),
    } as SessionEvent) as SessionActivity;
    state = foldActivityEvent(state, {
      type: "process_upserted",
      process: process(),
    } as SessionEvent) as SessionActivity;
    const next = foldActivityEvent(state, {
      type: "loop_removed",
      loopId: "loop-1",
    } as SessionEvent);
    expect(next?.loops ?? []).toEqual([]);
    expect(next?.processes).toEqual([process()]);
  });

  it("upserts processes and subagents by id", () => {
    const withProcess = foldActivityEvent(null, {
      type: "process_upserted",
      process: process(),
    } as SessionEvent) as SessionActivity;
    const exited = process({ status: { status: "exited", exitCode: 0 }, endedAt: "2026-07-03T00:01:00Z" });
    const next = foldActivityEvent(withProcess, {
      type: "process_upserted",
      process: exited,
    } as SessionEvent);
    expect(next?.processes).toEqual([exited]);

    const withAgent = foldActivityEvent(null, {
      type: "subagent_upserted",
      agent: subagent(),
    } as SessionEvent);
    expect(withAgent?.agents).toEqual([subagent()]);
  });
});
