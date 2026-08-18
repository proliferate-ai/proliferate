// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityProcessWire } from "#product/domain/activity/process";
import type { ActivitySubagentWire } from "#product/domain/activity/subagent";
import type { SessionActivityState } from "#product/hooks/activity/derived/use-session-activity";
import { useBackgroundCompletionReceipts } from "./use-background-completion-receipts";

function emptyActivity(): SessionActivityState {
  return {
    loops: [],
    loopCapabilities: { supported: false, native: false },
    processes: [],
    agents: [],
  };
}

// Per-session slice, same shape as use-background-work-finish-signal-tracking's
// test mock — lets a session's own roster diverge from the id the hook is
// called with.
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

function makeProcess(overrides: Partial<ActivityProcessWire>): ActivityProcessWire {
  return {
    id: "proc-1",
    command: "pytest -q tests/e2e",
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
    id: "task-1",
    agentType: "general",
    description: "audit the roster",
    model: null,
    background: true,
    status: { status: "running" },
    usage: null,
    feed: null,
    ...overrides,
  };
}

afterEach(() => {
  sessionActivityBySessionId = {};
  cleanup();
});

describe("useBackgroundCompletionReceipts", () => {
  it("appends a terminal receipt when a running process exits", () => {
    sessionActivityBySessionId["s1"] = {
      ...emptyActivity(),
      processes: [makeProcess({ id: "p1", status: { status: "running" } })],
    };
    const { result, rerender } = renderHook(
      ({ sessionId, anchorTurnId }) => useBackgroundCompletionReceipts(sessionId, anchorTurnId),
      { initialProps: { sessionId: "s1" as string | null, anchorTurnId: "turn-1" as string | null } },
    );
    expect(result.current).toEqual([]);

    sessionActivityBySessionId["s1"] = {
      ...emptyActivity(),
      processes: [
        makeProcess({
          id: "p1",
          status: { status: "exited", exitCode: 0 },
          endedAt: "2026-08-17T00:01:00.000Z",
        }),
      ],
    };
    rerender({ sessionId: "s1", anchorTurnId: "turn-1" });

    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({
      kind: "terminal",
      processId: "p1",
      command: "pytest -q tests/e2e",
      exitCode: 0,
    });
  });

  it("stamps the receipt with the anchor turn latest at observation, and does not restamp when a later (wake) turn arrives", () => {
    sessionActivityBySessionId["s1"] = {
      ...emptyActivity(),
      processes: [makeProcess({ id: "p1", status: { status: "running" } })],
    };
    const { result, rerender } = renderHook(
      ({ sessionId, anchorTurnId }) => useBackgroundCompletionReceipts(sessionId, anchorTurnId),
      { initialProps: { sessionId: "s1" as string | null, anchorTurnId: "turn-agent" as string | null } },
    );

    sessionActivityBySessionId["s1"] = {
      ...emptyActivity(),
      processes: [
        makeProcess({ id: "p1", status: { status: "exited", exitCode: 0 }, endedAt: "2026-08-17T00:01:00.000Z" }),
      ],
    };
    // The process exits while "turn-agent" is the latest turn.
    rerender({ sessionId: "s1", anchorTurnId: "turn-agent" });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].anchorTurnId).toBe("turn-agent");

    // The wake turn now streams in and becomes the latest turn — the already
    // emitted receipt keeps its original anchor rather than jumping after the
    // wake turn.
    rerender({ sessionId: "s1", anchorTurnId: "turn-wake" });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].anchorTurnId).toBe("turn-agent");
  });

  it("appends a subagent receipt when a running subagent vanishes, and does not double-append", () => {
    sessionActivityBySessionId["s1"] = { ...emptyActivity(), agents: [makeAgent({ id: "a1" })] };
    const { result, rerender } = renderHook(
      ({ sessionId, anchorTurnId }) => useBackgroundCompletionReceipts(sessionId, anchorTurnId),
      { initialProps: { sessionId: "s1" as string | null, anchorTurnId: "turn-1" as string | null } },
    );
    expect(result.current).toEqual([]);

    sessionActivityBySessionId["s1"] = { ...emptyActivity(), agents: [] };
    rerender({ sessionId: "s1", anchorTurnId: "turn-1" });
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ kind: "subagent", subagentId: "a1", outcome: "completed" });

    // A later idle pass must not re-emit the same completion.
    rerender({ sessionId: "s1", anchorTurnId: "turn-1" });
    expect(result.current).toHaveLength(1);
  });

  it("does NOT receipt work already finished at mount (roster-seed backlog)", () => {
    sessionActivityBySessionId["s1"] = {
      ...emptyActivity(),
      processes: [
        makeProcess({
          id: "seed",
          status: { status: "exited", exitCode: 0 },
          endedAt: "2026-08-17T00:00:30.000Z",
        }),
      ],
    };
    const { result } = renderHook(
      ({ sessionId, anchorTurnId }) => useBackgroundCompletionReceipts(sessionId, anchorTurnId),
      { initialProps: { sessionId: "s1" as string | null, anchorTurnId: "turn-1" as string | null } },
    );
    expect(result.current).toEqual([]);
  });

  it("resets its accumulation on session switch rather than carrying receipts across sessions", () => {
    sessionActivityBySessionId["s1"] = {
      ...emptyActivity(),
      processes: [makeProcess({ id: "p1", status: { status: "running" } })],
    };
    const { result, rerender } = renderHook(
      ({ sessionId, anchorTurnId }) => useBackgroundCompletionReceipts(sessionId, anchorTurnId),
      { initialProps: { sessionId: "s1" as string | null, anchorTurnId: "turn-1" as string | null } },
    );

    sessionActivityBySessionId["s1"] = {
      ...emptyActivity(),
      processes: [
        makeProcess({ id: "p1", status: { status: "exited", exitCode: 0 }, endedAt: "2026-08-17T00:01:00.000Z" }),
      ],
    };
    rerender({ sessionId: "s1", anchorTurnId: "turn-1" });
    expect(result.current).toHaveLength(1);

    sessionActivityBySessionId["s2"] = emptyActivity();
    rerender({ sessionId: "s2", anchorTurnId: null });
    expect(result.current).toEqual([]);
  });
});
