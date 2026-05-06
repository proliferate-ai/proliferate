import { describe, expect, it } from "vitest";
import {
  createTranscriptState,
  type PromptInputBlock,
  type SessionEventEnvelope,
  type TranscriptState,
} from "@anyharness/sdk";
import {
  bindOutboxSessionMaterialization,
  createPromptOutboxEntry,
  pruneEchoedOutboxTombstones,
  pruneEchoedOutboxTombstonesForTranscript,
  queuedOutboxEntriesForSession,
  reconcileOutboxFromEnvelopes,
  renderableOutboxEntriesForTranscript,
  resolvePromptOutboxPlacement,
  selectNextDispatchableOutboxEntry,
  upsertPromptOutboxEntry,
  type PromptOutboxStateShape,
} from "@/lib/domain/chat/prompt-outbox";

const NOW = "2026-01-01T00:00:00.000Z";

describe("prompt outbox", () => {
  it("snapshots prompt blocks and content parts when creating an entry", () => {
    const blocks: PromptInputBlock[] = [{ type: "text", text: "first" }];
    const attachmentSnapshots = [{
      id: "attachment-1",
      name: "notes.txt",
      mimeType: "text/plain",
      size: 12,
      kind: "text_resource" as const,
      source: "upload" as const,
      file: { name: "notes.txt" } as File,
    }];
    const entry = createPromptOutboxEntry({
      clientPromptId: "prompt-1",
      clientSessionId: "client-session-1",
      text: "first",
      blocks,
      attachmentSnapshots,
      now: NOW,
    });

    blocks[0] = { type: "text", text: "second" };
    attachmentSnapshots[0] = {
      ...attachmentSnapshots[0],
      name: "mutated.txt",
    };

    expect(entry.blocks).toEqual([{ type: "text", text: "first" }]);
    expect(entry.attachmentSnapshots).toMatchObject([{
      id: "attachment-1",
      name: "notes.txt",
    }]);
    expect(entry.contentParts).toEqual([{ type: "text", text: "first" }]);
  });

  it("keeps client session identity stable when materialized metadata arrives", () => {
    const state = withEntry(emptyState(), createPromptOutboxEntry({
      clientPromptId: "prompt-1",
      clientSessionId: "client-session-1",
      text: "ship it",
      blocks: [{ type: "text", text: "ship it" }],
      now: NOW,
    }));

    const next = bindOutboxSessionMaterialization(
      state,
      "client-session-1",
      "materialized-session-1",
    );

    expect(next.promptIdsByClientSessionId["client-session-1"]).toEqual(["prompt-1"]);
    expect(next.entriesByPromptId["prompt-1"]).toMatchObject({
      clientSessionId: "client-session-1",
      materializedSessionId: "materialized-session-1",
    });
  });

  it("selects only one dispatchable prompt per session in FIFO order", () => {
    let state = emptyState();
    state = withEntry(state, createPromptOutboxEntry({
      clientPromptId: "prompt-a",
      clientSessionId: "session-1",
      text: "a",
      blocks: [{ type: "text", text: "a" }],
      now: NOW,
    }));
    state = withEntry(state, createPromptOutboxEntry({
      clientPromptId: "prompt-b",
      clientSessionId: "session-1",
      text: "b",
      blocks: [{ type: "text", text: "b" }],
      now: NOW,
    }));

    expect(selectNextDispatchableOutboxEntry(state, "session-1")?.clientPromptId)
      .toBe("prompt-a");

    const blocked = {
      ...state,
      entriesByPromptId: {
        ...state.entriesByPromptId,
        "prompt-a": {
          ...state.entriesByPromptId["prompt-a"],
          deliveryState: "dispatching" as const,
        },
      },
    };

    expect(selectNextDispatchableOutboxEntry(blocked, "session-1")).toBeNull();
  });

  it("skips failed local prompts when selecting later dispatchable prompts", () => {
    let state = emptyState();
    state = withEntry(state, {
      ...createPromptOutboxEntry({
        clientPromptId: "prompt-failed",
        clientSessionId: "session-1",
        text: "failed",
        blocks: [{ type: "text", text: "failed" }],
        now: NOW,
      }),
      deliveryState: "failed_before_dispatch",
      errorMessage: "Local dispatch failed.",
    });
    state = withEntry(state, createPromptOutboxEntry({
      clientPromptId: "prompt-next",
      clientSessionId: "session-1",
      text: "next",
      blocks: [{ type: "text", text: "next" }],
      now: NOW,
    }));

    expect(selectNextDispatchableOutboxEntry(state, "session-1")?.clientPromptId)
      .toBe("prompt-next");
  });

  it("places a new prompt in the composer queue when the session is busy", () => {
    expect(resolvePromptOutboxPlacement({
      isSessionBusy: true,
      isSessionMaterialized: true,
      existingEntries: [],
    })).toBe("queue");
  });

  it("places the first prompt for a busy unmaterialized session in the transcript", () => {
    expect(resolvePromptOutboxPlacement({
      isSessionBusy: true,
      isSessionMaterialized: false,
      existingEntries: [],
    })).toBe("transcript");
  });

  it("still queues later prompts behind an unresolved unmaterialized transcript prompt", () => {
    const existing = createPromptOutboxEntry({
      clientPromptId: "prompt-a",
      clientSessionId: "client-session-1",
      text: "a",
      blocks: [{ type: "text", text: "a" }],
      now: NOW,
    });

    expect(resolvePromptOutboxPlacement({
      isSessionBusy: true,
      isSessionMaterialized: false,
      existingEntries: [existing],
    })).toBe("queue");
  });

  it("places a new prompt in the composer queue behind an unresolved local outbox row", () => {
    const existing = createPromptOutboxEntry({
      clientPromptId: "prompt-a",
      clientSessionId: "session-1",
      text: "a",
      blocks: [{ type: "text", text: "a" }],
      now: NOW,
    });

    expect(resolvePromptOutboxPlacement({
      isSessionBusy: false,
      existingEntries: [existing],
    })).toBe("queue");
  });

  it("allows transcript placement when older local failures are no longer blocking send order", () => {
    const failed = {
      ...createPromptOutboxEntry({
        clientPromptId: "prompt-a",
        clientSessionId: "session-1",
        text: "a",
        blocks: [{ type: "text", text: "a" }],
        now: NOW,
      }),
      deliveryState: "failed_before_dispatch" as const,
    };

    expect(resolvePromptOutboxPlacement({
      isSessionBusy: false,
      existingEntries: [failed],
    })).toBe("transcript");
  });

  it("reconciles pending prompt events by prompt id without content matching", () => {
    const state = withEntry(emptyState(), createPromptOutboxEntry({
      clientPromptId: "prompt-1",
      clientSessionId: "session-1",
      text: "original",
      blocks: [{ type: "text", text: "original" }],
      placement: "transcript",
      now: NOW,
    }));

    const next = reconcileOutboxFromEnvelopes(state, "session-1", [
      envelope({
        type: "pending_prompt_added",
        seq: 7,
        promptId: "prompt-1",
        text: "edited remotely",
        contentParts: [{ type: "text", text: "edited remotely" }],
        queuedAt: NOW,
        promptProvenance: null,
      }),
    ]);

    expect(next.entriesByPromptId["prompt-1"]).toMatchObject({
      placement: "queue",
      deliveryState: "accepted_queued",
      queuedSeq: 7,
    });
  });

  it("tombstones echoed rows and prunes them after the reconciliation ttl", () => {
    const echoedAt = new Date().toISOString();
    const state = withEntry(emptyState(), createPromptOutboxEntry({
      clientPromptId: "prompt-1",
      clientSessionId: "session-1",
      text: "hello",
      blocks: [{ type: "text", text: "hello" }],
      now: NOW,
    }));

    const echoed = reconcileOutboxFromEnvelopes(state, "session-1", [
      envelope({
        type: "item_started",
        item: {
          kind: "user_message",
          status: "completed",
          sourceAgentKind: "codex",
          isTransient: false,
          messageId: "message-1",
          promptId: "prompt-1",
          title: null,
          toolCallId: null,
          nativeToolName: null,
          parentToolCallId: null,
          rawInput: null,
          rawOutput: null,
          contentParts: [{ type: "text", text: "hello" }],
          promptProvenance: null,
        },
      }, echoedAt),
    ]);

    expect(echoed.entriesByPromptId["prompt-1"]).toMatchObject({
      deliveryState: "echoed_tombstone",
      echoedAt,
    });

    const pruned = pruneEchoedOutboxTombstones(
      echoed,
      Date.parse(echoedAt) + 5_000,
      5_000,
    );

    expect(pruned.entriesByPromptId["prompt-1"]).toBeUndefined();
    expect(pruned.promptIdsByClientSessionId["session-1"]).toEqual([]);
  });

  it("keeps echoed tombstones while the matching runtime turn is in progress", () => {
    const echoedAt = "2026-01-01T00:00:01.000Z";
    const echoed = withEntry(emptyState(), {
      ...createPromptOutboxEntry({
        clientPromptId: "prompt-1",
        clientSessionId: "session-1",
        text: "hello",
        blocks: [{ type: "text", text: "hello" }],
        now: NOW,
      }),
      deliveryState: "echoed_tombstone",
      echoedAt,
    });
    const transcript = transcriptWithUserPrompt("session-1", "prompt-1");

    const retained = pruneEchoedOutboxTombstonesForTranscript(
      echoed,
      transcript,
      Date.parse(echoedAt) + 60_000,
      5_000,
    );
    expect(retained.entriesByPromptId["prompt-1"]).toBeDefined();

    transcript.turnsById["turn-1"] = {
      ...transcript.turnsById["turn-1"],
      completedAt: "2026-01-01T00:01:01.000Z",
    };
    const pruned = pruneEchoedOutboxTombstonesForTranscript(
      retained,
      transcript,
      Date.parse(echoedAt) + 60_000,
      5_000,
    );
    expect(pruned.entriesByPromptId["prompt-1"]).toBeUndefined();
  });

  it("does not render a local row once runtime history has the same prompt id", () => {
    const entry = createPromptOutboxEntry({
      clientPromptId: "prompt-1",
      clientSessionId: "session-1",
      text: "hello",
      blocks: [{ type: "text", text: "hello" }],
      now: NOW,
    });
    const transcript = transcriptWithUserPrompt("session-1", "prompt-1");

    expect(renderableOutboxEntriesForTranscript([entry], transcript)).toEqual([]);
  });

  it("does not render local queued prompts in the transcript", () => {
    const entry = createPromptOutboxEntry({
      clientPromptId: "prompt-queued",
      clientSessionId: "session-1",
      text: "queued",
      blocks: [{ type: "text", text: "queued" }],
      placement: "queue",
      now: NOW,
    });

    expect(renderableOutboxEntriesForTranscript([
      entry,
    ], createTranscriptState("session-1"))).toEqual([]);
  });

  it("keeps failed local queued prompts out of the composer queue", () => {
    const failed = {
      ...createPromptOutboxEntry({
        clientPromptId: "prompt-failed",
        clientSessionId: "session-1",
        text: "failed",
        blocks: [{ type: "text", text: "failed" }],
        placement: "queue" as const,
        now: NOW,
      }),
      deliveryState: "failed_before_dispatch" as const,
      errorMessage: "Local dispatch failed.",
    };

    expect(queuedOutboxEntriesForSession([failed])).toEqual([]);
  });

  it("renders failed local queued prompts in the transcript for recovery actions", () => {
    const failed = {
      ...createPromptOutboxEntry({
        clientPromptId: "prompt-failed",
        clientSessionId: "session-1",
        text: "failed",
        blocks: [{ type: "text", text: "failed" }],
        placement: "queue" as const,
        now: NOW,
      }),
      deliveryState: "failed_before_dispatch" as const,
      errorMessage: "Local dispatch failed.",
    };

    expect(renderableOutboxEntriesForTranscript([
      failed,
    ], createTranscriptState("session-1"))).toEqual([failed]);
  });

  it("does not scan transcript items when there are no outbox entries", () => {
    const transcript = createTranscriptState("session-1");
    Object.defineProperty(transcript, "itemsById", {
      get() {
        throw new Error("itemsById should not be read without outbox entries");
      },
    });

    expect(renderableOutboxEntriesForTranscript([], transcript)).toEqual([]);
  });

  it("does not scan transcript items for queue-only outbox entries", () => {
    const queued = createPromptOutboxEntry({
      clientPromptId: "prompt-queued",
      clientSessionId: "session-1",
      text: "queued",
      blocks: [{ type: "text", text: "queued" }],
      placement: "queue",
      now: NOW,
    });
    const transcript = createTranscriptState("session-1");
    Object.defineProperty(transcript, "itemsById", {
      get() {
        throw new Error("itemsById should not be read for queue-only outbox entries");
      },
    });

    expect(renderableOutboxEntriesForTranscript([queued], transcript)).toEqual([]);
  });

  it("does not render later local transcript rows behind an unresolved prompt", () => {
    const first = createPromptOutboxEntry({
      clientPromptId: "prompt-first",
      clientSessionId: "session-1",
      text: "first",
      blocks: [{ type: "text", text: "first" }],
      placement: "transcript",
      now: NOW,
    });
    const misclassifiedQueued = createPromptOutboxEntry({
      clientPromptId: "prompt-second",
      clientSessionId: "session-1",
      text: "second",
      blocks: [{ type: "text", text: "second" }],
      placement: "transcript",
      now: NOW,
    });

    expect(renderableOutboxEntriesForTranscript([
      first,
      misclassifiedQueued,
    ], createTranscriptState("session-1"))).toEqual([first]);
  });
});

function emptyState(): PromptOutboxStateShape {
  return {
    entriesByPromptId: {},
    promptIdsByClientSessionId: {},
  };
}

function withEntry(
  state: PromptOutboxStateShape,
  entry: ReturnType<typeof createPromptOutboxEntry>,
): PromptOutboxStateShape {
  return upsertPromptOutboxEntry(state, entry);
}

function envelope(
  event: SessionEventEnvelope["event"],
  timestamp = NOW,
): SessionEventEnvelope {
  return {
    seq: 1,
    sessionId: "session-1",
    timestamp,
    turnId: "turn-1",
    itemId: "item-1",
    event,
  };
}

function transcriptWithUserPrompt(sessionId: string, promptId: string): TranscriptState {
  const transcript = createTranscriptState(sessionId);
  transcript.turnOrder.push("turn-1");
  transcript.turnsById["turn-1"] = {
    turnId: "turn-1",
    itemOrder: ["item-1"],
    startedAt: NOW,
    completedAt: null,
    stopReason: null,
    fileBadges: [],
  };
  transcript.itemsById["item-1"] = {
    itemId: "item-1",
    turnId: "turn-1",
    kind: "user_message",
    text: "hello",
    isStreaming: false,
    promptId,
    status: "completed",
    sourceAgentKind: "codex",
    messageId: "message-1",
    title: null,
    nativeToolName: null,
    parentToolCallId: null,
    contentParts: [{ type: "text", text: "hello" }],
    timestamp: NOW,
    startedSeq: 1,
    lastUpdatedSeq: 1,
    completedSeq: 1,
    completedAt: NOW,
  };
  return transcript;
}
