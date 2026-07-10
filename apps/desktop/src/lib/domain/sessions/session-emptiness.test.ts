import { describe, expect, it } from "vitest";
import {
  isSessionEmpty,
  isSessionEmptyWithIntents,
  type SessionEmptinessSnapshot,
} from "@/lib/domain/sessions/session-emptiness";

function makeSnapshot(overrides?: Partial<SessionEmptinessSnapshot>): SessionEmptinessSnapshot {
  return {
    transcript: { turnOrder: [] },
    events: [],
    optimisticPrompt: null,
    hasAttemptedPrompt: false,
    ...overrides,
  };
}

describe("isSessionEmpty", () => {
  it("returns true for a fresh session with no work", () => {
    expect(isSessionEmpty(makeSnapshot())).toBe(true);
  });

  it("returns false when transcript has turns", () => {
    expect(isSessionEmpty(makeSnapshot({
      transcript: { turnOrder: ["turn-1"] },
    }))).toBe(false);
  });

  it("returns false when an optimistic prompt exists", () => {
    expect(isSessionEmpty(makeSnapshot({
      optimisticPrompt: { text: "hello" },
    }))).toBe(false);
  });

  it("returns false when events have been received from the runtime stream", () => {
    expect(isSessionEmpty(makeSnapshot({
      events: [{ kind: "config_option_update" }],
    }))).toBe(false);
  });

  it("returns false when hasAttemptedPrompt is true", () => {
    expect(isSessionEmpty(makeSnapshot({
      hasAttemptedPrompt: true,
    }))).toBe(false);
  });

  it("returns false when multiple emptiness conditions are violated", () => {
    expect(isSessionEmpty(makeSnapshot({
      transcript: { turnOrder: ["turn-1"] },
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
      transcript: { turnOrder: ["turn-1"] },
    }), 0)).toBe(false);
  });

  it("returns false when session has attempted prompt and no intents", () => {
    expect(isSessionEmptyWithIntents(makeSnapshot({
      hasAttemptedPrompt: true,
    }), 0)).toBe(false);
  });
});
