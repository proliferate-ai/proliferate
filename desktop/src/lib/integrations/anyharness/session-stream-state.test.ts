import { describe, expect, it } from "vitest";
import { reduceEvents } from "@anyharness/sdk";
import type { SessionEventEnvelope } from "@anyharness/sdk";
import {
  appendHistoryTail,
  applyStreamEnvelope,
  replaySessionHistory,
} from "@/lib/integrations/anyharness/session-stream-state";

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
