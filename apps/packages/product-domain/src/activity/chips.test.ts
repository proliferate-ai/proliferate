import { describe, expect, it } from "vitest";
import { deriveActivityChips } from "./chips";
import type { LoopWire } from "./loop";
import type { ActivityProcessWire } from "./process";
import type { ActivitySubagentWire } from "./subagent";

function loop(overrides: Partial<LoopWire> = {}): LoopWire {
  return {
    loopId: "cron-1",
    prompt: "ping",
    schedule: { kind: "cron", expr: "*/1 * * * *" },
    recurring: true,
    status: "active",
    native: true,
    lastFiredAtMs: null,
    fireCount: 0,
    updatedAtMs: 1,
    ...overrides,
  };
}

function process(overrides: Partial<ActivityProcessWire> = {}): ActivityProcessWire {
  return {
    id: "proc-1",
    command: "sleep 30",
    cwd: null,
    status: { status: "running" },
    pid: null,
    startedAt: "2026-07-02T10:00:00.000Z",
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

describe("deriveActivityChips", () => {
  it("returns no chips when every roster is empty", () => {
    expect(deriveActivityChips({ loops: [], processes: [], agents: [] })).toEqual([]);
  });

  it("emits one chip per non-empty roster, counting armed loops only", () => {
    const chips = deriveActivityChips({
      loops: [loop({ loopId: "a" }), loop({ loopId: "b", status: "cleared" })],
      processes: [process({ id: "p1" }), process({ id: "p2", status: { status: "exited", exitCode: 0 } })],
      agents: [agent({ id: "t1" })],
    });
    expect(chips).toEqual([
      { kind: "loops", count: 1, liveCount: 1, label: "1 loop" },
      { kind: "terminals", count: 2, liveCount: 1, label: "2 terminals" },
      { kind: "agents", count: 1, liveCount: 1, label: "1 native subagent" },
    ]);
  });

  it("omits the loops chip when every loop is cleared", () => {
    const chips = deriveActivityChips({
      loops: [loop({ status: "cleared" })],
      processes: [],
      agents: [],
    });
    expect(chips).toEqual([]);
  });

  it("keeps the terminals chip visible for finished-but-listed processes", () => {
    const chips = deriveActivityChips({
      loops: [],
      processes: [process({ status: { status: "exited", exitCode: 0 } })],
      agents: [],
    });
    expect(chips).toEqual([
      { kind: "terminals", count: 1, liveCount: 0, label: "1 terminal" },
    ]);
  });
});
