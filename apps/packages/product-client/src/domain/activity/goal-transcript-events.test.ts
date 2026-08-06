import { describe, expect, it } from "vitest";
import type { Goal, SessionEventEnvelope } from "@anyharness/sdk";
import { deriveGoalTranscriptEvents } from "./goal-transcript-events";

function goal(overrides: Partial<Goal>): Goal {
  return {
    objective: "ship the thing",
    status: "active",
    nativeStatus: "active",
    native: true,
    revision: 1,
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    ...overrides,
  } as Goal;
}

function envelope(
  seq: number,
  type: "goal_updated" | "goal_met" | "goal_cleared",
  goalValue: Goal,
  turnId: string | null = null,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-07-02T00:00:${String(seq).padStart(2, "0")}.000Z`,
    turnId,
    event: { type, goal: goalValue } as SessionEventEnvelope["event"],
  };
}

describe("deriveGoalTranscriptEvents", () => {
  it("renders the first goal_updated sighting as 'set'", () => {
    const events = deriveGoalTranscriptEvents([
      envelope(1, "goal_updated", goal({ revision: 1 })),
    ]);
    expect(events).toEqual([
      {
        id: "1",
        seq: 1,
        turnId: null,
        kind: "set",
        objective: "ship the thing",
        detail: null,
      },
    ]);
  });

  it("dedupes consecutive accounting-only ticks (objective and status unchanged)", () => {
    const events = deriveGoalTranscriptEvents([
      envelope(1, "goal_updated", goal({ revision: 1, tokensUsed: 100 })),
      envelope(2, "goal_updated", goal({ revision: 1, tokensUsed: 500 })),
      envelope(3, "goal_updated", goal({ revision: 1, tokensUsed: 900, timeUsedSeconds: 30 })),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("set");
  });

  it("distinguishes 'edited' from 'set' via revision and objective change", () => {
    const events = deriveGoalTranscriptEvents([
      envelope(1, "goal_updated", goal({ revision: 1, objective: "ship v1" })),
      envelope(2, "goal_updated", goal({ revision: 2, objective: "ship v2" })),
    ]);
    expect(events.map((event) => event.kind)).toEqual(["set", "edited"]);
    expect(events[1].objective).toBe("ship v2");
  });

  it("treats a first sighting with revision > 1 (paginated history) as 'set', not 'edited'", () => {
    const events = deriveGoalTranscriptEvents([
      envelope(5, "goal_updated", goal({ revision: 3, objective: "already mid-flight" })),
    ]);
    expect(events).toEqual([
      expect.objectContaining({ kind: "set", objective: "already mid-flight" }),
    ]);
  });

  it("renders status-only transitions as paused/resumed, not edited", () => {
    const events = deriveGoalTranscriptEvents([
      envelope(1, "goal_updated", goal({ revision: 1, status: "active" })),
      envelope(2, "goal_updated", goal({ revision: 1, status: "paused" })),
      envelope(3, "goal_updated", goal({ revision: 1, status: "active" })),
    ]);
    expect(events.map((event) => event.kind)).toEqual(["set", "paused", "resumed"]);
  });

  it("renders goal_met with the evaluator reason as detail", () => {
    const events = deriveGoalTranscriptEvents([
      envelope(1, "goal_updated", goal({ revision: 1 })),
      envelope(2, "goal_met", goal({ revision: 1, status: "met", metReason: "DONE.txt exists" })),
    ]);
    expect(events[1]).toEqual(
      expect.objectContaining({ kind: "met", detail: "DONE.txt exists" }),
    );
  });

  describe("includeMet=false (met surfaced inline in the final message footer)", () => {
    it("suppresses the standalone 'met' row but keeps lifecycle tracking intact", () => {
      const events = deriveGoalTranscriptEvents(
        [
          envelope(1, "goal_updated", goal({ revision: 1, objective: "ship" })),
          envelope(2, "goal_met", goal({ revision: 1, status: "met", metReason: "done" })),
        ],
        { includeSetEdit: true, includeMet: false },
      );
      expect(events.map((event) => event.kind)).toEqual(["set"]);
    });

    it("still emits failed/blocked/cleared rows when met is suppressed", () => {
      const events = deriveGoalTranscriptEvents(
        [
          envelope(1, "goal_updated", goal({ revision: 1, objective: "ship" })),
          envelope(2, "goal_met", goal({ revision: 1, status: "met", metReason: "done" })),
          envelope(3, "goal_updated", goal({ revision: 1, objective: "next" })),
          envelope(4, "goal_updated", goal({ revision: 1, objective: "next", status: "blocked" })),
          envelope(5, "goal_updated", goal({ revision: 1, objective: "next", status: "failed" })),
          envelope(6, "goal_cleared", goal({ revision: 1, status: "cleared", objective: "next" })),
        ],
        { includeSetEdit: true, includeMet: false },
      );
      // met suppressed; the edit to "next" after met still classifies (the
      // met advanced tracking), and blocked/failed/cleared all render.
      expect(events.map((event) => event.kind)).toEqual([
        "set",
        "edited",
        "blocked",
        "failed",
        "cleared",
      ]);
    });

    it("defaults to emitting the met row when includeMet is omitted", () => {
      const events = deriveGoalTranscriptEvents([
        envelope(1, "goal_updated", goal({ revision: 1 })),
        envelope(2, "goal_met", goal({ revision: 1, status: "met" })),
      ]);
      expect(events.map((event) => event.kind)).toEqual(["set", "met"]);
    });
  });

  it("renders goal_cleared and resets lifecycle tracking so the next set reads as 'set'", () => {
    const events = deriveGoalTranscriptEvents([
      envelope(1, "goal_updated", goal({ revision: 1, objective: "first goal" })),
      envelope(2, "goal_cleared", goal({ revision: 1, status: "cleared", objective: "first goal" })),
      envelope(3, "goal_updated", goal({ revision: 1, objective: "second goal" })),
    ]);
    expect(events.map((event) => event.kind)).toEqual(["set", "cleared", "set"]);
    expect(events[2].objective).toBe("second goal");
  });

  it("tags each event with the turn active at that seq via envelope.turnId", () => {
    const events = deriveGoalTranscriptEvents([
      envelope(1, "goal_updated", goal({ revision: 1 }), null),
      envelope(2, "goal_updated", goal({ revision: 2, objective: "steered mid-turn" }), "turn-1"),
      envelope(3, "goal_met", goal({ revision: 2, status: "met" }), "turn-1"),
    ]);
    expect(events.map((event) => event.turnId)).toEqual([null, "turn-1", "turn-1"]);
  });

  it("ignores non-goal events and sorts out-of-order envelopes by seq", () => {
    const events = deriveGoalTranscriptEvents([
      envelope(3, "goal_met", goal({ revision: 1, status: "met" })),
      {
        sessionId: "session-1",
        seq: 2,
        timestamp: "2026-07-02T00:00:02.000Z",
        turnId: null,
        event: { type: "turn_started" } as SessionEventEnvelope["event"],
      },
      envelope(1, "goal_updated", goal({ revision: 1 })),
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 3]);
  });

  describe("includeSetEdit=false (harnesses that steer live, e.g. codex)", () => {
    it("suppresses 'set' and 'edited' rows but keeps lifecycle tracking intact", () => {
      const events = deriveGoalTranscriptEvents(
        [
          envelope(1, "goal_updated", goal({ revision: 1, objective: "ship v1" })),
          envelope(2, "goal_updated", goal({ revision: 2, objective: "ship v2" })),
          envelope(3, "goal_updated", goal({ revision: 2, objective: "ship v2", status: "paused" })),
          envelope(4, "goal_updated", goal({ revision: 2, objective: "ship v2", status: "active" })),
        ],
        { includeSetEdit: false },
      );
      // set (seq 1) and edited (seq 2) suppressed; paused/resumed still emit,
      // and the objective-change tracking still classifies seq 2 as an edit
      // internally (so seq 3 is a status-only paused, not an edit).
      expect(events.map((event) => [event.seq, event.kind])).toEqual([
        [3, "paused"],
        [4, "resumed"],
      ]);
    });

    it("still emits terminal outcome rows (met/failed/cleared) with set/edit suppressed", () => {
      const events = deriveGoalTranscriptEvents(
        [
          envelope(1, "goal_updated", goal({ revision: 1, objective: "ship" })),
          envelope(2, "goal_met", goal({ revision: 1, status: "met", metReason: "done" })),
          envelope(3, "goal_updated", goal({ revision: 1, objective: "next" })),
          envelope(4, "goal_updated", goal({ revision: 1, objective: "next", status: "failed" })),
          envelope(5, "goal_cleared", goal({ revision: 1, status: "cleared", objective: "next" })),
        ],
        { includeSetEdit: false },
      );
      expect(events.map((event) => event.kind)).toEqual(["met", "failed", "cleared"]);
    });

    it("defaults to including set/edit when no options are passed", () => {
      const events = deriveGoalTranscriptEvents([
        envelope(1, "goal_updated", goal({ revision: 1, objective: "ship" })),
      ]);
      expect(events.map((event) => event.kind)).toEqual(["set"]);
    });
  });
});
