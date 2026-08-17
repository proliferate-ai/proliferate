// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";
import type { SessionActivityState } from "#product/hooks/activity/derived/use-session-activity";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useBackgroundWorkFinishSignalTracking } from "./use-background-work-finish-signal-tracking";

let sessionActivity: SessionActivityState = {
  loops: [],
  loopCapabilities: { supported: false, native: false },
  processes: [],
  agents: [],
};

vi.mock("#product/hooks/activity/derived/use-session-activity", () => ({
  useSessionActivity: () => sessionActivity,
}));

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
  useWorkspaceUiStore.setState({ backgroundWorkLastFinishedSubagentBySession: {} });
});

describe("useBackgroundWorkFinishSignalTracking", () => {
  it("records nothing while every subagent stays running", () => {
    sessionActivity = { ...sessionActivity, agents: [makeAgent({ id: "agent-42" })] };
    const { rerender } = renderHook(
      ({ sessionId }) => useBackgroundWorkFinishSignalTracking(sessionId),
      { initialProps: { sessionId: "sess-1" as string | null } },
    );

    rerender({ sessionId: "sess-1" });

    expect(
      useWorkspaceUiStore.getState().backgroundWorkLastFinishedSubagentBySession["sess-1"] ?? null,
    ).toBeNull();
  });

  it("caches the last-seen snapshot when a running subagent disappears from the roster", () => {
    const agent = makeAgent({ id: "agent-42" });
    sessionActivity = { ...sessionActivity, agents: [agent] };
    const { rerender } = renderHook(
      ({ sessionId }) => useBackgroundWorkFinishSignalTracking(sessionId),
      { initialProps: { sessionId: "sess-1" as string | null } },
    );

    // Subagents leave the roster the instant they finish — the next
    // snapshot simply omits it.
    sessionActivity = { ...sessionActivity, agents: [] };
    rerender({ sessionId: "sess-1" });

    const cached = useWorkspaceUiStore.getState()
      .backgroundWorkLastFinishedSubagentBySession["sess-1"];
    expect(cached?.subagent).toEqual(agent);
    expect(cached?.atMs).toBeGreaterThan(0);
  });

  it("caches the real final status when the wire briefly exposes it before removal", () => {
    const running = makeAgent({ id: "agent-42", status: { status: "running" } });
    sessionActivity = { ...sessionActivity, agents: [running] };
    const { rerender } = renderHook(
      ({ sessionId }) => useBackgroundWorkFinishSignalTracking(sessionId),
      { initialProps: { sessionId: "sess-1" as string | null } },
    );

    const completed = makeAgent({
      id: "agent-42",
      status: { status: "completed", summary: "Done" },
    });
    sessionActivity = { ...sessionActivity, agents: [completed] };
    rerender({ sessionId: "sess-1" });

    const cached = useWorkspaceUiStore.getState()
      .backgroundWorkLastFinishedSubagentBySession["sess-1"];
    expect(cached?.subagent).toEqual(completed);
  });

  it("does not re-count a subagent that already finished on an earlier pass", () => {
    const agent = makeAgent({ id: "agent-42" });
    sessionActivity = { ...sessionActivity, agents: [agent] };
    const { rerender } = renderHook(
      ({ sessionId }) => useBackgroundWorkFinishSignalTracking(sessionId),
      { initialProps: { sessionId: "sess-1" as string | null } },
    );

    sessionActivity = { ...sessionActivity, agents: [] };
    rerender({ sessionId: "sess-1" });
    const firstAtMs = useWorkspaceUiStore.getState()
      .backgroundWorkLastFinishedSubagentBySession["sess-1"]?.atMs;

    // Nothing new happens on a later pass — the cached record must not move.
    rerender({ sessionId: "sess-1" });
    const secondAtMs = useWorkspaceUiStore.getState()
      .backgroundWorkLastFinishedSubagentBySession["sess-1"]?.atMs;
    expect(secondAtMs).toBe(firstAtMs);
  });

  it("keys the cache per session rather than mixing sessions on switch", () => {
    const agentOne = makeAgent({ id: "agent-1" });
    sessionActivity = { ...sessionActivity, agents: [agentOne] };
    const { rerender } = renderHook(
      ({ sessionId }) => useBackgroundWorkFinishSignalTracking(sessionId),
      { initialProps: { sessionId: "sess-1" as string | null } },
    );

    // Switch to a different session with a different subagent — no finish
    // for session 1 has happened, so nothing should be recorded for it, and
    // session 2 starts its own clean baseline (no false finish just from
    // switching).
    const agentTwo = makeAgent({ id: "agent-2" });
    sessionActivity = { ...sessionActivity, agents: [agentTwo] };
    rerender({ sessionId: "sess-2" });

    expect(
      useWorkspaceUiStore.getState().backgroundWorkLastFinishedSubagentBySession["sess-1"] ?? null,
    ).toBeNull();
    expect(
      useWorkspaceUiStore.getState().backgroundWorkLastFinishedSubagentBySession["sess-2"] ?? null,
    ).toBeNull();

    sessionActivity = { ...sessionActivity, agents: [] };
    rerender({ sessionId: "sess-2" });

    expect(
      useWorkspaceUiStore.getState().backgroundWorkLastFinishedSubagentBySession["sess-1"] ?? null,
    ).toBeNull();
    expect(
      useWorkspaceUiStore.getState().backgroundWorkLastFinishedSubagentBySession["sess-2"]?.subagent,
    ).toEqual(agentTwo);
  });
});
