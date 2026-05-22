import { describe, expect, it } from "vitest";
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
});
