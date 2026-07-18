import { describe, expect, it } from "vitest";
import { reduceEvents } from "@anyharness/sdk";
import type { SessionEventEnvelope } from "@anyharness/sdk";
import claudeNativeSubagentFixture from "../../../../../../../../fixtures/contracts/native-subagent-transcript/claude.json";
import codexNativeSubagentFixture from "../../../../../../../../fixtures/contracts/native-subagent-transcript/codex.json";
import {
  appendHistoryTail,
  applyStreamEnvelope,
  applyStreamEnvelopeBatch,
  replaySessionHistory,
} from "#product/lib/domain/sessions/stream/stream-state";

type NativeSubagentFixture = {
  provider: "claude" | "codex";
  sessionId: string;
  events: SessionEventEnvelope[];
};

const nativeSubagentFixtures = [
  claudeNativeSubagentFixture,
  codexNativeSubagentFixture,
] as unknown as NativeSubagentFixture[];

describe("session-stream-state", () => {
  describe.each(nativeSubagentFixtures)("$provider native subagent fixture", (fixture) => {
    it("deduplicates and orders a live batch to match durable replay", () => {
      const replay = replaySessionHistory(fixture.sessionId, fixture.events);
      const initial = replaySessionHistory(fixture.sessionId, fixture.events.slice(0, 1));
      const tail = fixture.events.slice(1);
      const duplicatedTailEvent = tail[Math.floor(tail.length / 2)];

      const result = applyStreamEnvelopeBatch(initial, [
        ...[...tail].reverse(),
        fixture.events[0],
        duplicatedTailEvent,
      ]);

      expect(result.gapEnvelope).toBeNull();
      expect(result.appliedEnvelopes.map((event) => event.seq)).toEqual(
        tail.map((event) => event.seq),
      );
      expect(result.duplicateEnvelopes.map((event) => event.seq)).toEqual([
        fixture.events[0].seq,
        duplicatedTailEvent.seq,
      ]);
      expect(result.state.events).toEqual(fixture.events);
      expect(result.state.transcript).toEqual(replay.transcript);
    });
  });

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

  it("does not advance history tail past a remaining sequence gap", () => {
    const state = replaySessionHistory("session-1", [turnStarted(1)]);

    const result = appendHistoryTail(state, [
      assistantDelta(4, "assistant-1", "lo"),
      assistantStarted(3, "assistant-1", "Hel"),
    ]);

    expect(result.applied).toBe(false);
    expect(result.state).toBe(state);
    expect(result.state.transcript.lastSeq).toBe(1);
  });

  it("applies only the contiguous history tail prefix before a gap", () => {
    const state = replaySessionHistory("session-1", [turnStarted(1)]);

    const result = appendHistoryTail(state, [
      assistantDelta(4, "assistant-1", "lo"),
      assistantStarted(2, "assistant-1", "Hel"),
    ]);

    expect(result.applied).toBe(true);
    expect(result.state.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(result.state.transcript.lastSeq).toBe(2);
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

  it("applies a high-volume reasoning frame as one transcript reduction batch", () => {
    const state = replaySessionHistory("session-1", [
      turnStarted(1),
      reasoningStarted(2, "reasoning-1", "seed:"),
    ]);
    const beforeItem = state.transcript.itemsById["reasoning-1"];
    const chunks = Array.from({ length: 200 }, (_, index) => `chunk-${index}|`);
    const instrumented = instrumentReasoningCopies(state, "reasoning-1");

    const result = applyStreamEnvelopeBatch(
      instrumented.state,
      chunks.map((chunk, index) => reasoningDelta(index + 3, "reasoning-1", chunk)),
    );
    const afterItem = result.state.transcript.itemsById["reasoning-1"];

    expect(result.gapEnvelope).toBeNull();
    expect(result.appliedEnvelopes).toHaveLength(200);
    expect(result.state.events).toHaveLength(202);
    expect(result.state.transcript.lastSeq).toBe(202);
    expect(instrumented.copyCounts).toEqual({ itemMap: 1, reasoningItem: 1 });
    expect(state.transcript.itemsById["reasoning-1"]).toBe(beforeItem);
    expect(afterItem).not.toBe(beforeItem);
    expect(afterItem.kind).toBe("thought");
    if (afterItem.kind !== "thought") {
      throw new Error("expected reasoning item");
    }
    expect(afterItem.text).toBe(`seed:${chunks.join("")}`);
  });

  it("applies a high-volume reasoning history tail as one transcript batch", () => {
    const state = replaySessionHistory("session-1", [
      turnStarted(1),
      reasoningStarted(2, "reasoning-1", "seed:"),
    ]);
    const instrumented = instrumentReasoningCopies(state, "reasoning-1");
    const chunks = Array.from({ length: 200 }, (_, index) => `tail-${index}|`);

    const result = appendHistoryTail(
      instrumented.state,
      chunks.map((chunk, index) => reasoningDelta(index + 3, "reasoning-1", chunk)),
    );

    expect(result.applied).toBe(true);
    expect(result.state.transcript.lastSeq).toBe(202);
    expect(instrumented.copyCounts).toEqual({ itemMap: 1, reasoningItem: 1 });
    const afterItem = result.state.transcript.itemsById["reasoning-1"];
    expect(afterItem.kind).toBe("thought");
    if (afterItem.kind !== "thought") {
      throw new Error("expected reasoning item");
    }
    expect(afterItem.text).toBe(`seed:${chunks.join("")}`);
  });

  it("sorts stream batches by sequence before detecting gaps", () => {
    const state = replaySessionHistory("session-1", [turnStarted(1)]);

    const result = applyStreamEnvelopeBatch(state, [
      assistantCompleted(4, "assistant-1", "Hello"),
      assistantStarted(2, "assistant-1", "Hel"),
      assistantDelta(3, "assistant-1", "lo"),
    ]);

    expect(result.gapEnvelope).toBeNull();
    expect(result.appliedEnvelopes.map((event) => event.seq)).toEqual([2, 3, 4]);
    expect(result.state.events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
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

function instrumentReasoningCopies(
  state: ReturnType<typeof replaySessionHistory>,
  itemId: string,
) {
  const item = state.transcript.itemsById[itemId];
  const copyCounts = { itemMap: 0, reasoningItem: 0 };
  return {
    copyCounts,
    state: {
      ...state,
      transcript: {
        ...state.transcript,
        itemsById: new Proxy({
          ...state.transcript.itemsById,
          [itemId]: new Proxy(item, {
            ownKeys(target) {
              copyCounts.reasoningItem += 1;
              return Reflect.ownKeys(target);
            },
          }),
        }, {
          ownKeys(target) {
            copyCounts.itemMap += 1;
            return Reflect.ownKeys(target);
          },
        }),
      },
    },
  };
}

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

function reasoningStarted(
  seq: number,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:${String(seq).padStart(2, "0")}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_started",
      item: {
        kind: "reasoning",
        status: "in_progress",
        sourceAgentKind: "codex",
        contentParts: [{ type: "reasoning", text, visibility: "private" }],
      },
    },
  };
}

function reasoningDelta(
  seq: number,
  itemId: string,
  appendReasoning: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:${String(seq).padStart(2, "0")}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_delta",
      delta: { appendReasoning },
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
