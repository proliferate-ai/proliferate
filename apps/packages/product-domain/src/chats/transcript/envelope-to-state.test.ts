import { describe, expect, it } from "vitest";
import type { ContentPart, SessionEventEnvelope, TranscriptState } from "@anyharness/sdk";
import { orderEnvelopesBySeq, reconstructTranscriptState } from "./envelope-to-state";

const SESSION_ID = "session-1";
const TURN_ID = "turn-1";

function at(seq: number): string {
  return `2026-05-01T00:00:${String(seq).padStart(2, "0")}Z`;
}

function turnStarted(seq: number): SessionEventEnvelope {
  return {
    sessionId: SESSION_ID,
    seq,
    timestamp: at(seq),
    turnId: TURN_ID,
    event: { type: "turn_started" },
  };
}

function turnEnded(seq: number): SessionEventEnvelope {
  return {
    sessionId: SESSION_ID,
    seq,
    timestamp: at(seq),
    turnId: TURN_ID,
    event: { type: "turn_ended", stopReason: "end_turn" },
  };
}

function userMessage(seq: number, itemId: string, text: string): SessionEventEnvelope {
  return {
    sessionId: SESSION_ID,
    seq,
    timestamp: at(seq),
    turnId: TURN_ID,
    itemId,
    event: {
      type: "item_completed",
      item: {
        kind: "user_message",
        status: "completed",
        sourceAgentKind: "claude",
        contentParts: [{ type: "text", text }],
      },
    },
  };
}

function assistantStarted(seq: number, itemId: string, text: string): SessionEventEnvelope {
  return {
    sessionId: SESSION_ID,
    seq,
    timestamp: at(seq),
    turnId: TURN_ID,
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

function assistantDelta(seq: number, itemId: string, appendText: string): SessionEventEnvelope {
  return {
    sessionId: SESSION_ID,
    seq,
    timestamp: at(seq),
    turnId: TURN_ID,
    itemId,
    event: { type: "item_delta", delta: { appendText } },
  };
}

function assistantCompleted(
  seq: number,
  itemId: string,
  contentParts: ContentPart[],
): SessionEventEnvelope {
  return {
    sessionId: SESSION_ID,
    seq,
    timestamp: at(seq),
    turnId: TURN_ID,
    itemId,
    event: {
      type: "item_completed",
      item: {
        kind: "assistant_message",
        status: "completed",
        sourceAgentKind: "claude",
        contentParts,
      },
    },
  };
}

function toolCompleted(seq: number, itemId: string): SessionEventEnvelope {
  return {
    sessionId: SESSION_ID,
    seq,
    timestamp: at(seq),
    turnId: TURN_ID,
    itemId,
    event: {
      type: "item_completed",
      item: {
        kind: "tool_invocation",
        status: "completed",
        sourceAgentKind: "claude",
        toolCallId: itemId,
        title: "Edit src/app.ts",
        contentParts: [
          { type: "tool_call", toolCallId: itemId, title: "Edit src/app.ts", toolKind: "edit" },
          {
            type: "file_change",
            operation: "edit",
            path: "src/app.ts",
            workspacePath: "src/app.ts",
            additions: 5,
            deletions: 2,
          },
        ],
      },
    },
  };
}

// A complete AnyHarness live stream: turn events, item lifecycle, and deltas.
function fullFidelityStream(): SessionEventEnvelope[] {
  return [
    turnStarted(1),
    userMessage(2, "user-1", "Fix the bug"),
    assistantStarted(3, "assistant-1", ""),
    assistantDelta(4, "assistant-1", "Done."),
    assistantCompleted(5, "assistant-1", [{ type: "text", text: "Done." }]),
    toolCompleted(6, "tool-1"),
    turnEnded(7),
  ];
}

// The current Cloud transcript projection stores one row per item
// (last-write-wins) and never persists turn or delta events. Reconstructed,
// that is the completed item rows only.
function cloudProjectedStream(): SessionEventEnvelope[] {
  return [
    userMessage(2, "user-1", "Fix the bug"),
    assistantCompleted(5, "assistant-1", [{ type: "text", text: "Done." }]),
    toolCompleted(6, "tool-1"),
  ];
}

function assistantText(state: TranscriptState, itemId: string): string {
  const item = state.itemsById[itemId];
  if (item.kind !== "assistant_prose") {
    throw new Error(`expected assistant_prose item at ${itemId}`);
  }
  return item.text;
}

describe("orderEnvelopesBySeq", () => {
  it("sorts envelopes by seq", () => {
    const ordered = orderEnvelopesBySeq([
      turnEnded(7),
      turnStarted(1),
      userMessage(2, "user-1", "hi"),
    ]);
    expect(ordered.map((envelope) => envelope.seq)).toEqual([1, 2, 7]);
  });

  it("drops envelopes that share a seq", () => {
    expect(orderEnvelopesBySeq([turnStarted(1), turnStarted(1)])).toHaveLength(1);
  });
});

describe("reconstructTranscriptState", () => {
  it("returns an empty transcript when there are no envelopes", () => {
    const state = reconstructTranscriptState(SESSION_ID, []);
    expect(state.sessionMeta.sessionId).toBe(SESSION_ID);
    expect(state.turnOrder).toEqual([]);
    expect(Object.keys(state.itemsById)).toEqual([]);
    expect(state.isStreaming).toBe(false);
  });

  it("converges a full-fidelity AnyHarness stream into a complete transcript", () => {
    const state = reconstructTranscriptState(SESSION_ID, fullFidelityStream());

    expect(state.turnOrder).toEqual([TURN_ID]);
    expect(state.turnsById[TURN_ID].itemOrder).toEqual(["user-1", "assistant-1", "tool-1"]);
    expect(assistantText(state, "assistant-1")).toBe("Done.");

    const turn = state.turnsById[TURN_ID];
    expect(turn.completedAt).not.toBeNull();
    expect(turn.stopReason).toBe("end_turn");
    expect(turn.fileBadges).toEqual([{ path: "src/app.ts", additions: 5, deletions: 2 }]);
    expect(state.isStreaming).toBe(false);
  });

  it("is order-independent: shuffled envelopes reduce to the same state", () => {
    const ordered = fullFidelityStream();
    const shuffled = [...ordered].reverse();
    expect(reconstructTranscriptState(SESSION_ID, shuffled)).toEqual(
      reconstructTranscriptState(SESSION_ID, ordered),
    );
  });

  it("is idempotent under duplicate envelope delivery", () => {
    const ordered = fullFidelityStream();
    const withDuplicates = [...ordered, ordered[2], ordered[5]];
    expect(reconstructTranscriptState(SESSION_ID, withDuplicates)).toEqual(
      reconstructTranscriptState(SESSION_ID, ordered),
    );
  });
});

// These tests pin Cloud-projection fidelity gaps. They assert today's reducer output against a stream
// shaped like the current Cloud projection, so each gap is a checked fact, not
// a spec assertion.
describe("Cloud-projection fidelity gaps", () => {
  it("renders items but loses turn-level metadata without turn events", () => {
    const state = reconstructTranscriptState(SESSION_ID, cloudProjectedStream());

    // Items still converge: each item_completed row carries full contentParts.
    expect(state.turnsById[TURN_ID].itemOrder).toEqual(["user-1", "assistant-1", "tool-1"]);
    expect(assistantText(state, "assistant-1")).toBe("Done.");

    // Gap: with no turn_ended event, turn completion + stop reason are unrecoverable.
    const turn = state.turnsById[TURN_ID];
    expect(turn.completedAt).toBeNull();
    expect(turn.stopReason).toBeNull();

    // The file_change data survives on the tool item ...
    const tool = state.itemsById["tool-1"];
    if (tool.kind !== "tool_call") {
      throw new Error("expected tool_call item");
    }
    expect(tool.contentParts.some((part) => part.type === "file_change")).toBe(true);
    // ... but turn.fileBadges aggregation only runs on turn_ended, so it stays empty.
    expect(turn.fileBadges).toEqual([]);
  });

  it("loses delta-only assistant text when item_completed omits content", () => {
    // Full stream: assistant text arrives only through item_delta and the
    // completion snapshot omits it.
    const full = reconstructTranscriptState(SESSION_ID, [
      turnStarted(1),
      assistantStarted(2, "assistant-1", ""),
      assistantDelta(3, "assistant-1", "Streamed answer."),
      assistantCompleted(4, "assistant-1", []),
      turnEnded(5),
    ]);
    expect(assistantText(full, "assistant-1")).toBe("Streamed answer.");

    // Cloud projection keeps only the item_completed row; item_delta is never
    // durable. If item_completed omits the streamed text, it is lost entirely.
    const cloud = reconstructTranscriptState(SESSION_ID, [
      assistantCompleted(4, "assistant-1", []),
    ]);
    expect(assistantText(cloud, "assistant-1")).toBe("");
  });
});
