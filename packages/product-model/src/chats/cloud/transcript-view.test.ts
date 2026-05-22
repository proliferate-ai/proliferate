import { describe, expect, it } from "vitest";
import type { SessionEventEnvelope } from "@anyharness/sdk";
import type {
  CloudSessionEvent,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";

import { buildCloudTranscriptView } from "./transcript-view";

describe("buildCloudTranscriptView", () => {
  it("falls back to projected transcript items when retained events lack envelopes", () => {
    const events: CloudSessionEvent[] = [
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 1,
        eventType: "item_completed",
        sourceKind: "runtime",
        envelope: null,
      },
    ];
    const fallbackItems: CloudTranscriptItem[] = [
      {
        itemId: "item-1",
        turnId: "turn-1",
        kind: "user_message",
        status: "completed",
        text: "hello from projection",
        firstSeq: 1,
        lastSeq: 1,
      },
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events,
      fallbackItems,
    });

    expect(view.source).toBe("projection");
    expect(view.missingEnvelopeCount).toBe(1);
    expect(view.rows).toEqual([
      expect.objectContaining({
        body: "hello from projection",
        kind: "user",
      }),
    ]);
  });

  it("uses event rows when some retained envelopes are missing and projection is empty", () => {
    const events: CloudSessionEvent[] = [
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 1,
        eventType: "item_completed",
        sourceKind: "runtime",
        envelope: userEnvelope(1, "hello from envelope"),
      },
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 2,
        eventType: "session_state_update",
        sourceKind: "runtime",
        envelope: null,
      },
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events,
      fallbackItems: [],
    });

    expect(view.source).toBe("events");
    expect(view.missingEnvelopeCount).toBe(1);
    expect(view.rows).toEqual([
      expect.objectContaining({
        body: "hello from envelope",
        kind: "user",
        firstSeq: 1,
        lastSeq: 1,
      }),
    ]);
  });

  it("uses newer event rows instead of stale projection when later envelopes render", () => {
    const events: CloudSessionEvent[] = [
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 1,
        eventType: "item_completed",
        sourceKind: "runtime",
        envelope: userEnvelope(1, "old projection text"),
      },
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 2,
        eventType: "item_completed",
        sourceKind: "runtime",
        envelope: userEnvelope(2, "newer event text"),
      },
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 3,
        eventType: "session_state_update",
        sourceKind: "runtime",
        envelope: null,
      },
    ];
    const fallbackItems: CloudTranscriptItem[] = [
      {
        itemId: "item-1",
        turnId: "turn-1",
        kind: "user_message",
        status: "completed",
        text: "old projection text",
        firstSeq: 1,
        lastSeq: 1,
      },
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events,
      fallbackItems,
    });

    expect(view.source).toBe("events");
    expect(view.missingEnvelopeCount).toBe(1);
    expect(view.rows).toEqual([
      expect.objectContaining({
        body: "old projection text",
        kind: "user",
        firstSeq: 1,
        lastSeq: 1,
      }),
      expect.objectContaining({
        body: "newer event text",
        kind: "user",
        firstSeq: 2,
        lastSeq: 2,
      }),
    ]);
  });
});

function userEnvelope(seq: number, text: string): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-05-22T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId: `user-${seq}`,
    event: {
      type: "item_completed",
      item: {
        kind: "user_message",
        status: "completed",
        sourceAgentKind: "codex",
        contentParts: [{ type: "text", text }],
      },
    },
  };
}
