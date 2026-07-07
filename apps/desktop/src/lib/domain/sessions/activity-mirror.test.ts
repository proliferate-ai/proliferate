import { describe, expect, it } from "vitest";
import type {
  ActivityProcess,
  ActivitySubagent,
  Loop,
  SessionActionCapabilities,
  SessionActivity,
} from "@anyharness/sdk";
import {
  activityProcessWireFromMirror,
  activitySubagentWireFromMirror,
  loopCapabilitiesForSession,
  loopWireFromMirror,
  projectSessionActivity,
} from "@/lib/domain/sessions/activity-mirror";

describe("loopCapabilitiesForSession", () => {
  it("projects supported + native from action capabilities", () => {
    const caps = { supportsLoops: true, loopsNative: true } as SessionActionCapabilities;
    expect(loopCapabilitiesForSession(caps)).toEqual({ supported: true, native: true });
  });

  it("treats emulated loops as supported but not native", () => {
    const caps = { supportsLoops: true, loopsNative: false } as SessionActionCapabilities;
    expect(loopCapabilitiesForSession(caps)).toEqual({ supported: true, native: false });
  });

  it("defaults to unsupported when flags are absent", () => {
    expect(loopCapabilitiesForSession({} as SessionActionCapabilities)).toEqual({
      supported: false,
      native: false,
    });
  });
});

describe("loopWireFromMirror", () => {
  it("maps loop fields and defaults lastFiredAtMs to null", () => {
    const loop: Loop = {
      loopId: "loop-1",
      prompt: "ping",
      schedule: { kind: "cron", expr: "*/5 * * * *" },
      recurring: true,
      status: "active",
      native: false,
      fireCount: 2,
      updatedAtMs: 5,
    };
    expect(loopWireFromMirror(loop)).toEqual({
      loopId: "loop-1",
      prompt: "ping",
      schedule: { kind: "cron", expr: "*/5 * * * *" },
      recurring: true,
      status: "active",
      native: false,
      lastFiredAtMs: null,
      fireCount: 2,
      updatedAtMs: 5,
    });
  });
});

describe("activityProcessWireFromMirror", () => {
  it("maps an exited process with its exit code and absent optionals as null", () => {
    const process: ActivityProcess = {
      id: "proc-1",
      command: "sleep 30",
      status: { status: "exited", exitCode: 0 },
      startedAt: "2026-07-03T00:00:00Z",
    };
    expect(activityProcessWireFromMirror(process)).toEqual({
      id: "proc-1",
      command: "sleep 30",
      cwd: null,
      status: { status: "exited", exitCode: 0 },
      pid: null,
      startedAt: "2026-07-03T00:00:00Z",
      endedAt: null,
      feed: null,
    });
  });

  it("carries a feed ref through", () => {
    const process: ActivityProcess = {
      id: "proc-2",
      command: "tail -f log",
      status: { status: "running" },
      startedAt: "2026-07-03T00:00:00Z",
      feed: { feedId: "feed-9", kind: "terminal_bytes" },
    };
    expect(activityProcessWireFromMirror(process).feed).toEqual({
      feedId: "feed-9",
      kind: "terminal_bytes",
    });
  });
});

describe("activitySubagentWireFromMirror", () => {
  it("maps a completed subagent with usage", () => {
    const agent: ActivitySubagent = {
      id: "agent-1",
      agentType: "reviewer",
      description: "review",
      model: "sonnet",
      background: true,
      status: { status: "completed", summary: "done" },
      usage: { tokensUsed: 10, toolCalls: 2, durationSeconds: 3 },
    };
    expect(activitySubagentWireFromMirror(agent)).toEqual({
      id: "agent-1",
      agentType: "reviewer",
      description: "review",
      model: "sonnet",
      background: true,
      status: { status: "completed", summary: "done" },
      usage: { tokensUsed: 10, toolCalls: 2, durationSeconds: 3 },
      feed: null,
    });
  });
});

describe("projectSessionActivity", () => {
  it("returns empty rosters for null", () => {
    expect(projectSessionActivity(null)).toEqual({ loops: [], processes: [], agents: [] });
  });

  it("projects all roster collections", () => {
    const activity: SessionActivity = {
      turn: { status: "idle" },
      loops: [
        {
          loopId: "loop-1",
          prompt: "ping",
          schedule: { kind: "interval", expr: "5m" },
          recurring: true,
          status: "active",
          native: true,
          fireCount: 0,
          updatedAtMs: 1,
        },
      ],
      processes: [
        {
          id: "proc-1",
          command: "sleep 30",
          status: { status: "running" },
          startedAt: "2026-07-03T00:00:00Z",
        },
      ],
      agents: [
        { id: "agent-1", background: false, status: { status: "running" } },
      ],
    };
    const projected = projectSessionActivity(activity);
    expect(projected.loops).toHaveLength(1);
    expect(projected.processes).toHaveLength(1);
    expect(projected.agents).toHaveLength(1);
    expect(projected.agents[0]?.background).toBe(false);
  });
});
