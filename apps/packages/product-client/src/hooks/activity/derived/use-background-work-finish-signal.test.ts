// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityProcessWire } from "#product/domain/activity/process";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";
import type { SessionActivityState } from "#product/hooks/activity/derived/use-session-activity";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useBackgroundWorkFinishSignal } from "./use-background-work-finish-signal";

let sessionActivity: SessionActivityState = {
  loops: [],
  loopCapabilities: { supported: false, native: false },
  processes: [],
  agents: [],
};

vi.mock("#product/hooks/activity/derived/use-session-activity", () => ({
  useSessionActivity: () => sessionActivity,
}));

function makeProcess(overrides: Partial<ActivityProcessWire>): ActivityProcessWire {
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

function makeAgent(overrides: Partial<ActivitySubagentWire>): ActivitySubagentWire {
  return {
    id: "agent-1",
    agentType: "claude-subagent",
    description: "Explore ACP session lifecycle",
    model: null,
    background: true,
    status: { status: "running" },
    usage: null,
    feed: null,
    ...overrides,
  };
}

afterEach(() => {
  sessionActivity = {
    loops: [],
    loopCapabilities: { supported: false, native: false },
    processes: [],
    agents: [],
  };
  cleanup();
  useWorkspaceUiStore.setState({
    backgroundWorkLastFinishedSubagentBySession: {},
    backgroundWorkLastViewedAtBySession: {},
  });
});

describe("useBackgroundWorkFinishSignal", () => {
  it("returns no signal and is never dirty with no session", () => {
    const { result } = renderHook(() => useBackgroundWorkFinishSignal(null));
    expect(result.current).toEqual({ signal: null, dirty: false });
  });

  it("returns no signal and is never dirty while nothing has finished", () => {
    sessionActivity = {
      ...sessionActivity,
      processes: [makeProcess({ status: { status: "running" } })],
    };
    const { result } = renderHook(() => useBackgroundWorkFinishSignal("sess-1"));
    expect(result.current).toEqual({ signal: null, dirty: false });
  });

  it("is dirty when a process finished and the pane was never viewed", () => {
    const exited = makeProcess({
      status: { status: "exited", exitCode: 0 },
      endedAt: "2026-08-17T00:05:00.000Z",
    });
    sessionActivity = { ...sessionActivity, processes: [exited] };
    const { result } = renderHook(() => useBackgroundWorkFinishSignal("sess-1"));
    expect(result.current.dirty).toBe(true);
    expect(result.current.signal).toEqual({
      kind: "process",
      process: exited,
      atMs: Date.parse("2026-08-17T00:05:00.000Z"),
    });
  });

  it("is not dirty once the recorded last-viewed time is after the finish", () => {
    const exited = makeProcess({
      status: { status: "exited", exitCode: 0 },
      endedAt: "2026-08-17T00:05:00.000Z",
    });
    sessionActivity = { ...sessionActivity, processes: [exited] };
    useWorkspaceUiStore.setState({
      backgroundWorkLastViewedAtBySession: {
        "sess-1": Date.parse("2026-08-17T00:10:00.000Z"),
      },
    });
    const { result } = renderHook(() => useBackgroundWorkFinishSignal("sess-1"));
    expect(result.current.dirty).toBe(false);
  });

  it("reads a cached finished subagent from the store when no process has finished", () => {
    const agent = makeAgent({ id: "agent-42" });
    useWorkspaceUiStore.setState({
      backgroundWorkLastFinishedSubagentBySession: {
        "sess-1": { subagent: agent, atMs: 1_000 },
      },
    });
    const { result } = renderHook(() => useBackgroundWorkFinishSignal("sess-1"));
    expect(result.current.signal).toEqual({ kind: "subagent", subagent: agent, atMs: 1_000 });
    expect(result.current.dirty).toBe(true);
  });

  it("scopes the cached subagent and last-viewed lookups per session — a different session's finish stays invisible", () => {
    const agent = makeAgent({ id: "agent-42" });
    useWorkspaceUiStore.setState({
      backgroundWorkLastFinishedSubagentBySession: {
        "sess-other": { subagent: agent, atMs: 1_000 },
      },
    });
    const { result } = renderHook(() => useBackgroundWorkFinishSignal("sess-1"));
    expect(result.current).toEqual({ signal: null, dirty: false });
  });
});
