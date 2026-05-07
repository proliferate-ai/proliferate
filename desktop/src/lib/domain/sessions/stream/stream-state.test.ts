import { describe, expect, it } from "vitest";
import { reduceEvents } from "@anyharness/sdk";
import type { SessionEventEnvelope } from "@anyharness/sdk";
import {
  appendHistoryTail,
  applyStreamEnvelope,
  applyStreamEnvelopeBatch,
  replaySessionHistory,
} from "@/lib/domain/sessions/stream/stream-state";

describe("session-stream-state", () => {
  it("ignores duplicate stream envelopes", () => {
    const state = replaySessionHistory("session-1", [turnStarted(1)]);

    const result = applyStreamEnvelope(state, turnStarted(1));

    expect(result.status).toBe("duplicate");
    expect(result.state.events).toHaveLength(1);
    expect(result.state.transcript.lastSeq).toBe(1);
  });

  it("flags sequence gaps in the live stream", () => {
    const state = replaySessionHistory("session-1", [turnStarted(1)]);

    const result = applyStreamEnvelope(state, turnEnded(3));

    expect(result.status).toBe("gap");
    expect(result.state.transcript.lastSeq).toBe(1);
  });

  it("matches full replay when history is hydrated and then extended with a live tail", () => {
    const events = [
      turnStarted(1),
      assistantStarted(2, "assistant-1", "Hel"),
      assistantDelta(3, "assistant-1", "lo"),
      assistantCompleted(4, "assistant-1", "Hello"),
      turnEnded(5),
    ];

    const splitState = replaySessionHistory("session-1", events.slice(0, 2));
    const tailResult = appendHistoryTail(splitState, events.slice(2));

    expect(tailResult.applied).toBe(true);
    expect(tailResult.state.transcript).toEqual(
      reduceEvents(events, "session-1", { replayMode: true }),
    );
  });

  it("treats empty tail history as a no-op", () => {
    const state = replaySessionHistory("session-1", [
      turnStarted(1),
      assistantStarted(2, "assistant-1", "Hello"),
    ]);

    const result = appendHistoryTail(state, []);

    expect(result.applied).toBe(false);
    expect(result.state).toBe(state);
    expect(result.state.events).toBe(state.events);
    expect(result.state.transcript).toBe(state.transcript);
  });

  it("treats duplicate tail history as a no-op", () => {
    const events = [
      turnStarted(1),
      assistantStarted(2, "assistant-1", "Hello"),
    ];
    const state = replaySessionHistory("session-1", events);

    const result = appendHistoryTail(state, events);

    expect(result.applied).toBe(false);
    expect(result.state).toBe(state);
    expect(result.state.events).toBe(state.events);
    expect(result.state.transcript).toBe(state.transcript);
  });

  it("applies a contiguous stream batch with one events array copy", () => {
    const state = replaySessionHistory("session-1", [turnStarted(1)]);

    const result = applyStreamEnvelopeBatch(state, [
      assistantStarted(2, "assistant-1", "Hel"),
      assistantDelta(3, "assistant-1", "lo"),
      assistantCompleted(4, "assistant-1", "Hello"),
    ]);

    expect(result.gapEnvelope).toBeNull();
    expect(result.appliedEnvelopes.map((event) => event.seq)).toEqual([2, 3, 4]);
    expect(result.state.events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(result.state.events).not.toBe(state.events);
    expect(result.state.transcript.lastSeq).toBe(4);
  });

  it("applies the contiguous prefix before a mid-batch gap", () => {
    const state = replaySessionHistory("session-1", [turnStarted(1)]);

    const result = applyStreamEnvelopeBatch(state, [
      assistantStarted(2, "assistant-1", "Hel"),
      turnEnded(4),
      assistantDelta(5, "assistant-1", "lo"),
    ]);

    expect(result.appliedEnvelopes.map((event) => event.seq)).toEqual([2]);
    expect(result.gapEnvelope?.seq).toBe(4);
    expect(result.skippedAfterGapEnvelopes.map((event) => event.seq)).toEqual([5]);
    expect(result.state.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(result.state.transcript.lastSeq).toBe(2);
  });

  it("does not mutate tail history state while appending", () => {
    const state = replaySessionHistory("session-1", [
      turnStarted(1),
      assistantStarted(2, "assistant-1", "Hel"),
    ]);
    const previousItem = state.transcript.itemsById["assistant-1"];
    const previousEvents = state.events;

    const result = appendHistoryTail(state, [assistantDelta(3, "assistant-1", "lo")]);

    expect(result.applied).toBe(true);
    expect(state.events).toBe(previousEvents);
    expect(state.transcript.itemsById["assistant-1"]).toBe(previousItem);
    expect(result.state.events).not.toBe(previousEvents);
    expect(result.state.transcript.itemsById["assistant-1"]).not.toBe(previousItem);
  });
});

function turnStarted(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: { type: "turn_started" },
  };
}

function assistantStarted(
  seq: number,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_started",
      item: {
        kind: "assistant_message",
        status: "in_progress",
        sourceAgentKind: "claude",
        contentParts: [{ type: "text", text }],
      },
    },
  };
}

function assistantDelta(
  seq: number,
  itemId: string,
  appendText: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_delta",
      delta: {
        appendText,
      },
    },
  };
}

function assistantCompleted(
  seq: number,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_completed",
      item: {
        kind: "assistant_message",
        status: "completed",
        sourceAgentKind: "claude",
        contentParts: [{ type: "text", text }],
      },
    },
  };
}

function turnEnded(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: { type: "turn_ended", stopReason: "end_turn" },
  };
}
