import { describe, expect, it } from "vitest";
import type { SessionEventEnvelope } from "@anyharness/sdk";
import type {
  CloudPendingInteraction,
  CloudSessionEvent,
  CloudTranscriptItem,
} from "@proliferate/cloud-sdk";

import {
  buildCloudTranscriptView,
  cloudTranscriptHasAgentProgressAfterPrompt,
  cloudTranscriptHasUserPrompt,
} from "./transcript-view";

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

  it("falls back to projection when a later missing envelope is newer than rendered event rows", () => {
    const events: CloudSessionEvent[] = [
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 1,
        eventType: "item_completed",
        sourceKind: "runtime",
        envelope: userEnvelope(1, "rendered from event"),
      },
      {
        targetId: "target-1",
        sessionId: "session-1",
        seq: 3,
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
        text: "rendered from event",
        firstSeq: 1,
        lastSeq: 1,
      },
      {
        itemId: "item-2",
        turnId: "turn-1",
        kind: "assistant_message",
        status: "completed",
        text: "projection-only assistant",
        firstSeq: 2,
        lastSeq: 2,
      },
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events,
      fallbackItems,
    });

    expect(view.source).toBe("projection");
    expect(view.rows).toEqual([
      expect.objectContaining({
        body: "rendered from event",
        kind: "user",
      }),
      expect.objectContaining({
        body: "projection-only assistant",
        kind: "assistant",
      }),
    ]);
  });

  it("reconciles optimistic prompts from event rows even when old projection items exist", () => {
    const oldItems: CloudTranscriptItem[] = [
      {
        itemId: "old-user",
        turnId: "old-turn",
        kind: "user_message",
        status: "completed",
        text: "old prompt",
        firstSeq: 1,
        lastSeq: 1,
      },
    ];
    const rows = [
      {
        id: "event-user",
        kind: "user" as const,
        body: "repeatable prompt",
        firstSeq: 5,
        lastSeq: 5,
      },
      {
        id: "event-assistant",
        kind: "assistant" as const,
        body: "started",
        firstSeq: 6,
        lastSeq: 6,
      },
    ];
    const prompt = { text: "repeatable prompt", baseTranscriptSeq: 4 };

    expect(cloudTranscriptHasUserPrompt({
      prompt,
      transcriptItems: oldItems,
      transcriptRows: rows,
    })).toBe(true);
    expect(cloudTranscriptHasAgentProgressAfterPrompt({
      prompt,
      transcriptItems: oldItems,
      transcriptRows: rows,
    })).toBe(true);
  });

  it("detects event-row assistant progress after a projected prompt item", () => {
    const items: CloudTranscriptItem[] = [
      {
        itemId: "projected-user",
        turnId: "turn-1",
        kind: "user_message",
        status: "completed",
        text: "new prompt",
        firstSeq: 5,
        lastSeq: 5,
      },
    ];
    const rows = [
      {
        id: "event-assistant",
        kind: "assistant" as const,
        body: "assistant from event",
        firstSeq: 6,
        lastSeq: 6,
      },
    ];

    expect(cloudTranscriptHasAgentProgressAfterPrompt({
      prompt: { text: "new prompt", baseTranscriptSeq: 4 },
      transcriptItems: items,
      transcriptRows: rows,
    })).toBe(true);
  });

  it("does not dedupe a pending repeated prompt against older matching transcript rows", () => {
    const fallbackItems: CloudTranscriptItem[] = [
      {
        itemId: "old-user",
        turnId: "turn-1",
        kind: "user_message",
        status: "completed",
        text: "repeatable prompt",
        firstSeq: 1,
        lastSeq: 1,
      },
      {
        itemId: "old-assistant",
        turnId: "turn-1",
        kind: "assistant_message",
        status: "completed",
        text: "old response",
        firstSeq: 2,
        lastSeq: 2,
      },
    ];
    const pendingInteractions: CloudPendingInteraction[] = [
      pendingPromptInteraction({
        requestId: "prompt-2",
        requestedSeq: 2,
        text: "repeatable prompt",
      }),
    ];

    const view = buildCloudTranscriptView({
      sessionId: "session-1",
      events: [],
      fallbackItems,
      pendingInteractions,
    });

    expect(view.rows).toEqual([
      expect.objectContaining({
        id: "projection:old-user",
        body: "repeatable prompt",
        kind: "user",
      }),
      expect.objectContaining({
        id: "projection:old-assistant",
        body: "old response",
        kind: "assistant",
      }),
      expect.objectContaining({
        id: "pending-prompt:prompt-2:user",
        body: "repeatable prompt",
        kind: "user",
      }),
      expect.objectContaining({
        id: "pending-prompt:prompt-2:assistant-waiting",
        body: "Waiting for response.",
        kind: "assistant",
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

function pendingPromptInteraction(input: {
  requestId: string;
  requestedSeq: number;
  text: string;
}): CloudPendingInteraction {
  return {
    requestId: input.requestId,
    kind: "send_prompt",
    status: "pending",
    title: "Queued prompt",
    description: "Waiting for response.",
    payload: {
      text: input.text,
      promptId: input.requestId,
      commandId: `command-${input.requestId}`,
    },
    requestedSeq: input.requestedSeq,
    resolvedSeq: null,
    requestedAt: "2026-05-22T00:00:00Z",
    resolvedAt: null,
  };
}
