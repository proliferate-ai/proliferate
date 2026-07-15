import { describe, expect, it } from "vitest";
import {
  isSessionEmpty,
  isSessionEmptyWithIntents,
  type SessionEmptinessSnapshot,
} from "@/lib/domain/sessions/session-emptiness";

function makeSnapshot(overrides?: Partial<SessionEmptinessSnapshot>): SessionEmptinessSnapshot {
  return {
    transcript: {
      isStreaming: false,
      pendingInteractions: [],
      pendingPrompts: [],
      turnOrder: [],
    },
    events: [],
    optimisticPrompt: null,
    hasAttemptedPrompt: false,
    activeGoal: null,
    executionSummary: null,
    lastPromptAt: null,
    sessionActivity: null,
    status: "idle",
    ...overrides,
  };
}

describe("isSessionEmpty", () => {
  it("returns true for a fresh session with no work", () => {
    expect(isSessionEmpty(makeSnapshot())).toBe(true);
  });

  it("returns false when transcript has turns", () => {
    expect(isSessionEmpty(makeSnapshot({
      transcript: {
        isStreaming: false,
        pendingInteractions: [],
        pendingPrompts: [],
        turnOrder: ["turn-1"],
      },
    }))).toBe(false);
  });

  it("returns false when an optimistic prompt exists", () => {
    expect(isSessionEmpty(makeSnapshot({
      optimisticPrompt: { text: "hello" },
    }))).toBe(false);
  });

  it("ignores harmless runtime and config events", () => {
    expect(isSessionEmpty(makeSnapshot({
      events: [{ kind: "config_option_update" }],
    }))).toBe(true);
  });

  it("returns false when hasAttemptedPrompt is true", () => {
    expect(isSessionEmpty(makeSnapshot({
      hasAttemptedPrompt: true,
    }))).toBe(false);
  });

  it("returns false when a goal is active", () => {
    expect(isSessionEmpty(makeSnapshot({
      activeGoal: { id: "goal-1" },
    }))).toBe(false);
  });

  it("returns false when the transcript has a pending interaction", () => {
    expect(isSessionEmpty(makeSnapshot({
      transcript: {
        isStreaming: false,
        pendingInteractions: [{ requestId: "request-1" } as never],
        pendingPrompts: [],
        turnOrder: [],
      },
    }))).toBe(false);
  });

  it("returns false when the execution summary has a pending interaction", () => {
    expect(isSessionEmpty(makeSnapshot({
      executionSummary: {
        pendingInteractions: [{ requestId: "request-1" } as never],
        phase: "awaiting_interaction",
      },
    }))).toBe(false);
  });

  it.each([
    ["a queued runtime prompt", { transcript: {
      isStreaming: false,
      pendingInteractions: [],
      pendingPrompts: [{ seq: 1 } as never],
      turnOrder: [],
    } }],
    ["a prior prompt timestamp", { lastPromptAt: "2026-07-10T00:00:00Z" }],
    ["a live activity loop", { sessionActivity: {
      turn: { status: "idle" },
      loops: [{ loopId: "loop-1" } as never],
    } }],
  ])("returns false for %s", (_label, overrides) => {
    expect(isSessionEmpty(makeSnapshot(overrides as Partial<SessionEmptinessSnapshot>)))
      .toBe(false);
  });

  it("allows the canonical materialized idle activity snapshot", () => {
    expect(isSessionEmpty(makeSnapshot({
      sessionActivity: {
        turn: { status: "idle" },
        loops: [],
        processes: [],
        agents: [],
      },
    }))).toBe(true);
  });

  it("ignores startup liveness without durable user work", () => {
    expect(isSessionEmpty(makeSnapshot({
      transcript: {
        isStreaming: true,
        pendingInteractions: [],
        pendingPrompts: [],
        turnOrder: [],
      },
      events: [
        { kind: "session_started" },
        { kind: "config_option_update" },
        { kind: "available_commands_update" },
      ],
      executionSummary: {
        pendingInteractions: [],
        phase: "running",
      },
      sessionActivity: {
        turn: {
          status: "running",
          turnId: "startup-only",
          startedAt: "2026-07-10T00:00:00Z",
        },
        loops: [],
        processes: [],
        agents: [],
      },
      status: "running",
    }))).toBe(true);
  });

  it("returns false when multiple emptiness conditions are violated", () => {
    expect(isSessionEmpty(makeSnapshot({
      transcript: {
        isStreaming: false,
        pendingInteractions: [],
        pendingPrompts: [],
        turnOrder: ["turn-1"],
      },
      hasAttemptedPrompt: true,
      optimisticPrompt: { text: "hi" },
    }))).toBe(false);
  });
});

describe("isSessionEmptyWithIntents", () => {
  it("returns true when session is empty and no outbox intents exist", () => {
    expect(isSessionEmptyWithIntents(makeSnapshot(), 0)).toBe(true);
  });

  it("returns false when session is empty but outbox has queued prompts", () => {
    expect(isSessionEmptyWithIntents(makeSnapshot(), 1)).toBe(false);
  });

  it("returns false when session has transcript turns regardless of intent count", () => {
    expect(isSessionEmptyWithIntents(makeSnapshot({
      transcript: {
        isStreaming: false,
        pendingInteractions: [],
        pendingPrompts: [],
        turnOrder: ["turn-1"],
      },
    }), 0)).toBe(false);
  });

  it("returns false when session has attempted prompt and no intents", () => {
    expect(isSessionEmptyWithIntents(makeSnapshot({
      hasAttemptedPrompt: true,
    }), 0)).toBe(false);
  });
});
