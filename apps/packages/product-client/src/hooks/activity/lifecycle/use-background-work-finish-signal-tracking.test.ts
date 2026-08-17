// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityProcessWire } from "#product/domain/activity/process";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";
import type { SessionActivityState } from "#product/hooks/activity/derived/use-session-activity";
import { deriveLatestBackgroundWorkFinishSignal } from "#product/domain/activity/background-work-finish-signal";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useBackgroundWorkFinishSignalTracking } from "./use-background-work-finish-signal-tracking";

function emptyActivity(): SessionActivityState {
  return {
    loops: [],
    loopCapabilities: { supported: false, native: false },
    processes: [],
    agents: [],
  };
}

// Keyed by session id — NOT a single shared variable switched in lockstep
// with whatever `sessionId` prop the test happens to pass. That lockstep
// shape is exactly what let the R5 review round 2 MAJOR (the hook silently
// reading the globally-active session instead of its own `sessionId`
// parameter) slip past the original tests: a mock that always returns
// "whatever session the prop currently says" can't tell the two
// implementations apart. This map lets a session's OWN data diverge from
// whichever `sessionId` the hook is CALLED with, so a test can genuinely
// simulate "this session's roster changed while a DIFFERENT session was
// being tracked."
let sessionActivityBySessionId: Record<string, SessionActivityState> = {};

vi.mock("#product/hooks/activity/derived/use-session-activity", () => ({
  useSessionActivityForSession: (sessionId: string | null) =>
    (sessionId ? sessionActivityBySessionId[sessionId] : undefined) ?? {
      loops: [],
      loopCapabilities: { supported: false, native: false },
      processes: [],
      agents: [],
    },
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

afterEach(() => {
  sessionActivityBySessionId = {};
  cleanup();
  useWorkspaceUiStore.setState({ backgroundWorkLastFinishedSubagentBySession: {} });
});

describe("useBackgroundWorkFinishSignalTracking", () => {
  it("records nothing while every subagent stays running", () => {
    sessionActivityBySessionId["sess-1"] = { ...emptyActivity(), agents: [makeAgent({ id: "agent-42" })] };
    const { rerender } = renderHook(
      ({ sessionId }) => useBackgroundWorkFinishSignalTracking(sessionId),
      { initialProps: { sessionId: "sess-1" as string | null } },
    );

    rerender({ sessionId: "sess-1" });

    expect(
      useWorkspaceUiStore.getState().backgroundWorkLastFinishedSubagentBySession["sess-1"] ?? null,
    ).toBeNull();
  });

  it("caches the last-seen snapshot when a running subagent disappears from the roster while actively tracked", () => {
    const agent = makeAgent({ id: "agent-42" });
    sessionActivityBySessionId["sess-1"] = { ...emptyActivity(), agents: [agent] };
    const { rerender } = renderHook(
      ({ sessionId }) => useBackgroundWorkFinishSignalTracking(sessionId),
      { initialProps: { sessionId: "sess-1" as string | null } },
    );

    // Subagents leave the roster the instant they finish — the next
    // snapshot simply omits it.
    sessionActivityBySessionId["sess-1"] = { ...emptyActivity(), agents: [] };
    rerender({ sessionId: "sess-1" });

    const cached = useWorkspaceUiStore.getState()
      .backgroundWorkLastFinishedSubagentBySession["sess-1"];
    expect(cached?.subagent).toEqual(agent);
    expect(cached?.detectedAtMs).toBeGreaterThan(0);
  });

  it("caches the real final status when the wire briefly exposes it before removal", () => {
    const running = makeAgent({ id: "agent-42", status: { status: "running" } });
    sessionActivityBySessionId["sess-1"] = { ...emptyActivity(), agents: [running] };
    const { rerender } = renderHook(
      ({ sessionId }) => useBackgroundWorkFinishSignalTracking(sessionId),
      { initialProps: { sessionId: "sess-1" as string | null } },
    );

    const completed = makeAgent({
      id: "agent-42",
      status: { status: "completed", summary: "Done" },
    });
    sessionActivityBySessionId["sess-1"] = { ...emptyActivity(), agents: [completed] };
    rerender({ sessionId: "sess-1" });

    const cached = useWorkspaceUiStore.getState()
      .backgroundWorkLastFinishedSubagentBySession["sess-1"];
    expect(cached?.subagent).toEqual(completed);
  });

  it("does not re-count a subagent that already finished on an earlier pass", () => {
    const agent = makeAgent({ id: "agent-42" });
    sessionActivityBySessionId["sess-1"] = { ...emptyActivity(), agents: [agent] };
    const { rerender } = renderHook(
      ({ sessionId }) => useBackgroundWorkFinishSignalTracking(sessionId),
      { initialProps: { sessionId: "sess-1" as string | null } },
    );

    sessionActivityBySessionId["sess-1"] = { ...emptyActivity(), agents: [] };
    rerender({ sessionId: "sess-1" });
    const firstDetectedAtMs = useWorkspaceUiStore.getState()
      .backgroundWorkLastFinishedSubagentBySession["sess-1"]?.detectedAtMs;

    // Nothing new happens on a later pass — the cached record must not move.
    rerender({ sessionId: "sess-1" });
    const secondDetectedAtMs = useWorkspaceUiStore.getState()
      .backgroundWorkLastFinishedSubagentBySession["sess-1"]?.detectedAtMs;
    expect(secondDetectedAtMs).toBe(firstDetectedAtMs);
  });

  it("keys the cache per session rather than mixing sessions on switch", () => {
    const agentOne = makeAgent({ id: "agent-1" });
    sessionActivityBySessionId["sess-1"] = { ...emptyActivity(), agents: [agentOne] };
    const { rerender } = renderHook(
      ({ sessionId }) => useBackgroundWorkFinishSignalTracking(sessionId),
      { initialProps: { sessionId: "sess-1" as string | null } },
    );

    // Switch to a different session with a different subagent — no finish
    // for session 1 has happened, so nothing should be recorded for it, and
    // session 2 starts its own clean baseline (no false finish just from
    // switching).
    const agentTwo = makeAgent({ id: "agent-2" });
    sessionActivityBySessionId["sess-2"] = { ...emptyActivity(), agents: [agentTwo] };
    rerender({ sessionId: "sess-2" });

    expect(
      useWorkspaceUiStore.getState().backgroundWorkLastFinishedSubagentBySession["sess-1"] ?? null,
    ).toBeNull();
    expect(
      useWorkspaceUiStore.getState().backgroundWorkLastFinishedSubagentBySession["sess-2"] ?? null,
    ).toBeNull();

    sessionActivityBySessionId["sess-2"] = { ...emptyActivity(), agents: [] };
    rerender({ sessionId: "sess-2" });

    expect(
      useWorkspaceUiStore.getState().backgroundWorkLastFinishedSubagentBySession["sess-1"] ?? null,
    ).toBeNull();
    expect(
      useWorkspaceUiStore.getState().backgroundWorkLastFinishedSubagentBySession["sess-2"]?.subagent,
    ).toEqual(agentTwo);
  });

  // R5 review round 2 — finding #3 (MAJOR follow-through): a subagent
  // finishes in session A while the tracker is mounted for a DIFFERENT
  // session B (this hook is only ever mounted once, for whichever session
  // is currently rendered — see the module docstring). Session A's own
  // slice changes independently in the mock's per-session map WHILE B is
  // being tracked, simulating exactly the case the review flagged. Detection
  // is deferred to switch-back by construction (disclosed in the module
  // docstring), so this proves: (1) nothing is recorded for A while B is
  // active, (2) switching back to A correctly detects the vanish using
  // whatever A last looked like before the switch away, and (3) the
  // resulting (necessarily late) detection timestamp still does NOT outrank
  // a process with a real, later `endedAt` once fed through the actual
  // ranking function — i.e. the wrong-name bug is closed end-to-end, not
  // just at the isolated domain-function level.
  it("detects a subagent that finished while its session was inactive, on switch-back — and a real process endedAt still outranks the late detection", () => {
    const agent = makeAgent({ id: "agent-in-session-a" });
    sessionActivityBySessionId["session-a"] = { ...emptyActivity(), agents: [agent] };
    sessionActivityBySessionId["session-b"] = emptyActivity();

    const { rerender } = renderHook(
      ({ sessionId }) => useBackgroundWorkFinishSignalTracking(sessionId),
      { initialProps: { sessionId: "session-a" as string | null } },
    );

    // The user switches to session B. The tracker now only watches B.
    rerender({ sessionId: "session-b" });
    expect(
      useWorkspaceUiStore.getState().backgroundWorkLastFinishedSubagentBySession["session-a"] ?? null,
    ).toBeNull();

    // While the user is on B, session A's subagent finishes for real —
    // nobody is watching, so nothing is recorded yet.
    sessionActivityBySessionId["session-a"] = { ...emptyActivity(), agents: [] };
    rerender({ sessionId: "session-b" });
    expect(
      useWorkspaceUiStore.getState().backgroundWorkLastFinishedSubagentBySession["session-a"] ?? null,
    ).toBeNull();

    // The user switches back to A. The tracker resumes watching it, diffs
    // against the stale (running) snapshot from before the switch away, and
    // finally detects the vanish.
    rerender({ sessionId: "session-a" });
    const cached = useWorkspaceUiStore.getState()
      .backgroundWorkLastFinishedSubagentBySession["session-a"];
    expect(cached?.subagent).toEqual(agent);
    expect(cached?.detectedAtMs).toBeGreaterThan(0);

    // Feed the (necessarily late) detection through the real ranking
    // function alongside a process that really did finish more recently in
    // wall-clock terms — the process must win.
    const realProcess = makeProcess({
      id: "proc-real",
      status: { status: "exited", exitCode: 0 },
      endedAt: new Date(cached!.detectedAtMs + 1_000).toISOString(),
    });
    const signal = deriveLatestBackgroundWorkFinishSignal({
      processes: [realProcess],
      cachedFinishedSubagent: { subagent: cached!.subagent, detectedAtMs: cached!.detectedAtMs },
      lastViewedAtMs: null,
    });
    expect(signal).toEqual({
      kind: "process",
      process: realProcess,
      atMs: Date.parse(realProcess.endedAt!),
    });
  });
});
