import { describe, expect, it } from "vitest";
import {
  createTranscriptState,
  reduceEvent,
  reduceEventBatch,
  reduceEvents,
} from "../../index.js";
import type { SessionEventEnvelope, ThoughtItem } from "../../index.js";

describe("transcript batch reducer", () => {
  it("treats an empty batch as a referential no-op", () => {
    const before = createTranscriptState("session-1");

    expect(reduceEventBatch(before, [])).toBe(before);
  });

  it("avoids per-delta copies for a high-volume reasoning item", () => {
    const before = reduceEvents([
      turnStarted(1),
      reasoningStarted(2, "reasoning-1", "seed:"),
      assistantCompleted(3, "assistant-1", "done"),
    ], "session-1");
    const beforeItem = before.itemsById["reasoning-1"] as ThoughtItem;
    const beforeAssistant = before.itemsById["assistant-1"];
    const beforeContentParts = beforeItem.contentParts;
    const beforeContentPart = beforeContentParts[0];
    const chunks = Array.from({ length: 200 }, (_, index) => `chunk-${index}|`);
    const deltas = chunks.map((chunk, index) =>
      reasoningDelta(index + 4, "reasoning-1", chunk)
    );
    const copies = { itemMap: 0, reasoningItem: 0 };
    const instrumentedItem = new Proxy(beforeItem, {
      ownKeys(target) {
        copies.reasoningItem += 1;
        return Reflect.ownKeys(target);
      },
    });
    const instrumentedState = {
      ...before,
      itemsById: new Proxy({
        ...before.itemsById,
        "reasoning-1": instrumentedItem,
      }, {
        ownKeys(target) {
          copies.itemMap += 1;
          return Reflect.ownKeys(target);
        },
      }),
    };

    const after = reduceEventBatch(instrumentedState, deltas);
    const sequential = deltas.reduce(reduceOne, before);
    const afterItem = after.itemsById["reasoning-1"] as ThoughtItem;

    expect(after).toEqual(sequential);
    expect(copies).toEqual({ itemMap: 1, reasoningItem: 1 });
    expect(after.turnsById).toBe(before.turnsById);
    expect(before.itemsById["reasoning-1"]).toBe(beforeItem);
    expect(after.itemsById["assistant-1"]).toBe(beforeAssistant);
    expect(beforeItem.contentParts).toBe(beforeContentParts);
    expect(beforeContentParts[0]).toBe(beforeContentPart);
    expect(beforeContentPart).toEqual({
      type: "reasoning",
      text: "seed:",
      visibility: "private",
    });
    expect(beforeItem.text).toBe("seed:");
    expect(afterItem).not.toBe(beforeItem);
    expect(afterItem.contentParts).not.toBe(beforeContentParts);
    expect(afterItem.text).toBe(`seed:${chunks.join("")}`);
    expect(after.lastSeq).toBe(203);
  });

  it("preserves order-sensitive sequential semantics for one item", () => {
    const before = reduceEvents([
      turnStarted(1),
      reasoningStarted(2, "reasoning-1", "seed"),
    ], "session-1");
    const events = [
      reasoningDelta(3, "reasoning-1", ":append"),
      reasoningSnapshotDelta(4, "reasoning-1", "snapshot"),
      reasoningDelta(5, "reasoning-1", ":tail"),
      reasoningCompleted(6, "reasoning-1", "final"),
    ];

    const batched = reduceEventBatch(before, events);
    const sequential = events.reduce(reduceOne, before);
    const item = batched.itemsById["reasoning-1"] as ThoughtItem;

    expect(batched).toEqual(sequential);
    expect(item.text).toBe("final");
    expect(item.isStreaming).toBe(false);
  });
});

function reduceOne(state: ReturnType<typeof createTranscriptState>, event: SessionEventEnvelope) {
  return reduceEvent(state, event);
}

function baseEnvelope(seq: number, itemId?: string) {
  return {
    sessionId: "session-1",
    seq,
    timestamp: "2026-04-04T00:00:00Z",
    turnId: "turn-1",
    ...(itemId ? { itemId } : {}),
  };
}

function turnStarted(seq: number): SessionEventEnvelope {
  return { ...baseEnvelope(seq), event: { type: "turn_started" } };
}

function reasoningStarted(seq: number, itemId: string, text: string): SessionEventEnvelope {
  return {
    ...baseEnvelope(seq, itemId),
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
    ...baseEnvelope(seq, itemId),
    event: { type: "item_delta", delta: { appendReasoning } },
  };
}

function reasoningSnapshotDelta(
  seq: number,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return {
    ...baseEnvelope(seq, itemId),
    event: {
      type: "item_delta",
      delta: {
        replaceContentParts: [{ type: "reasoning", text, visibility: "private" }],
      },
    },
  };
}

function reasoningCompleted(seq: number, itemId: string, text: string): SessionEventEnvelope {
  return {
    ...baseEnvelope(seq, itemId),
    event: {
      type: "item_completed",
      item: {
        kind: "reasoning",
        status: "completed",
        sourceAgentKind: "codex",
        contentParts: [{ type: "reasoning", text, visibility: "private" }],
      },
    },
  };
}

function assistantCompleted(seq: number, itemId: string, text: string): SessionEventEnvelope {
  return {
    ...baseEnvelope(seq, itemId),
    event: {
      type: "item_completed",
      item: {
        kind: "assistant_message",
        status: "completed",
        sourceAgentKind: "codex",
        contentParts: [{ type: "text", text }],
      },
    },
  };
}
