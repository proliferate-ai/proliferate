import { describe, expect, it } from "vitest";
import { createTranscriptState, type PendingPromptEntry, type TranscriptState } from "@anyharness/sdk";
import {
  buildTranscriptRowModel,
  createTranscriptRowModelCache,
} from "@/lib/domain/chat/transcript-row-model";
import { createPromptOutboxEntry } from "@/lib/domain/chat/prompt-outbox";
import {
  shouldStickToVirtualBottom,
} from "@/lib/domain/chat/transcript-virtual-rows";
import {
  parseTranscriptVirtualizationMode,
  resolveTranscriptVirtualizationEnabled,
} from "@/lib/domain/chat/transcript-virtualization-config";

describe("buildTranscriptRowModel", () => {
  it("creates stable turn rows for large transcripts", () => {
    const transcript = createTranscriptState("session-1");
    for (let index = 0; index < 1000; index += 1) {
      addTurn(transcript, `turn-${index}`, true);
    }

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: "turn-999",
      latestTurnHasAssistantRenderableContent: true,
    });

    expect(rows).toHaveLength(1000);
    expect(rows[0]).toEqual(expect.objectContaining({
      kind: "turn",
      key: "turn:turn-0:block:content",
      turnId: "turn-0",
      blockKey: "content",
    }));
    expect(rows[999]).toEqual(expect.objectContaining({
      kind: "turn",
      key: "turn:turn-999:block:content",
      turnId: "turn-999",
      blockKey: "content",
    }));
  });

  it("hides an empty in-progress latest turn behind the visible pending prompt", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-complete", true);
    addTurn(transcript, "turn-live", false);

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: pendingPrompt(),
      latestTurnId: "turn-live",
      latestTurnHasAssistantRenderableContent: false,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "turn",
        key: "turn:turn-complete:block:content",
        turnId: "turn-complete",
        blockKey: "content",
      }),
      { kind: "pending_prompt", key: "pending-prompt:session-1" },
    ]);
  });

  it("keeps an in-progress latest turn when it already has renderable content", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-live", false);
    addUserItem(transcript, "turn-live", "item-user", "Previous visible content");

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: pendingPrompt(),
      latestTurnId: "turn-live",
      latestTurnHasAssistantRenderableContent: false,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "turn",
        key: "turn:turn-live:block:content",
        turnId: "turn-live",
        blockKey: "content",
      }),
      { kind: "pending_prompt", key: "pending-prompt:session-1" },
    ]);
  });

  it("keeps the latest turn once it has assistant-renderable content", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-live", false);

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: pendingPrompt(),
      latestTurnId: "turn-live",
      latestTurnHasAssistantRenderableContent: true,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "turn",
        key: "turn:turn-live:block:content",
        turnId: "turn-live",
        blockKey: "content",
      }),
      { kind: "pending_prompt", key: "pending-prompt:session-1" },
    ]);
  });

  it("splits large turns into stable display-block rows", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-large", false);
    addAssistantItems(transcript, "turn-large", 30);

    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: "turn-large",
      latestTurnHasAssistantRenderableContent: true,
    });

    expect(rows).toHaveLength(30);
    expect(rows[0]).toEqual(expect.objectContaining({
      kind: "turn",
      key: "turn:turn-large:block:item-0",
      turnId: "turn-large",
      blockKey: "item-0",
      isFirstTurnRow: true,
      isLastTurnRow: false,
    }));
    expect(rows[29]).toEqual(expect.objectContaining({
      kind: "turn",
      key: "turn:turn-large:block:item-29",
      turnId: "turn-large",
      blockKey: "item-29",
      isFirstTurnRow: false,
      isLastTurnRow: true,
    }));
  });

  it("reuses unchanged turn rows from the presentation cache", () => {
    const transcript = createTranscriptState("session-1");
    addTurn(transcript, "turn-1", true);
    const cache = createTranscriptRowModelCache();

    const firstRows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: "turn-1",
      latestTurnHasAssistantRenderableContent: true,
    }, cache);
    const secondRows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      latestTurnId: "turn-1",
      latestTurnHasAssistantRenderableContent: true,
    }, cache);

    expect(secondRows[0]).toBe(firstRows[0]);
  });

  it("keys pending prompts by active session", () => {
    const transcript = createTranscriptState("session-1");
    const rows = buildTranscriptRowModel({
      activeSessionId: "session-2",
      transcript,
      visibleOptimisticPrompt: pendingPrompt(),
      latestTurnId: null,
      latestTurnHasAssistantRenderableContent: false,
    });

    expect(rows).toEqual([
      { kind: "pending_prompt", key: "pending-prompt:session-2" },
    ]);
  });

  it("keys outbox prompt rows by prompt id", () => {
    const transcript = createTranscriptState("session-1");
    const rows = buildTranscriptRowModel({
      activeSessionId: "session-1",
      transcript,
      visibleOptimisticPrompt: null,
      visibleOutboxEntries: [
        createPromptOutboxEntry({
          clientPromptId: "prompt-1",
          clientSessionId: "session-1",
          text: "queued",
          blocks: [{ type: "text", text: "queued" }],
          now: "2026-01-01T00:00:00.000Z",
        }),
      ],
      latestTurnId: null,
      latestTurnHasAssistantRenderableContent: false,
    });

    expect(rows).toEqual([
      { kind: "outbox_prompt", key: "prompt:prompt-1", clientPromptId: "prompt-1" },
    ]);
  });
});

describe("shouldStickToVirtualBottom", () => {
  it("stays sticky when asynchronous row measurement grows total size near the bottom", () => {
    expect(shouldStickToVirtualBottom({
      scrollOffset: 920,
      viewportSize: 500,
      totalVirtualSize: 1500,
      thresholdPx: 96,
    })).toBe(true);
  });

  it("does not stick when the user has scrolled into history", () => {
    expect(shouldStickToVirtualBottom({
      scrollOffset: 300,
      viewportSize: 500,
      totalVirtualSize: 1500,
      thresholdPx: 96,
    })).toBe(false);
  });
});

describe("transcript virtualization config", () => {
  it("parses the single tri-state localStorage value", () => {
    expect(parseTranscriptVirtualizationMode("auto")).toBe("auto");
    expect(parseTranscriptVirtualizationMode("on")).toBe("on");
    expect(parseTranscriptVirtualizationMode("off")).toBe("off");
    expect(parseTranscriptVirtualizationMode("1")).toBe("auto");
    expect(parseTranscriptVirtualizationMode(null)).toBe("auto");
  });

  it("enables virtualization automatically only for large row counts", () => {
    expect(resolveTranscriptVirtualizationEnabled({
      mode: "auto",
      rowCount: 79,
      autoRowThreshold: 80,
    })).toBe(false);
    expect(resolveTranscriptVirtualizationEnabled({
      mode: "auto",
      rowCount: 80,
      autoRowThreshold: 80,
    })).toBe(true);
  });

  it("allows explicit on/off overrides", () => {
    expect(resolveTranscriptVirtualizationEnabled({
      mode: "on",
      rowCount: 1,
      autoRowThreshold: 80,
    })).toBe(true);
    expect(resolveTranscriptVirtualizationEnabled({
      mode: "off",
      rowCount: 1000,
      autoRowThreshold: 80,
    })).toBe(false);
  });
});

function addTurn(
  transcript: TranscriptState,
  turnId: string,
  completed: boolean,
) {
  transcript.turnOrder.push(turnId);
  transcript.turnsById[turnId] = {
    turnId,
    itemOrder: [],
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: completed ? "2026-01-01T00:00:01.000Z" : null,
    stopReason: completed ? "stop" : null,
    fileBadges: [],
  };
}

function addAssistantItems(
  transcript: TranscriptState,
  turnId: string,
  count: number,
) {
  const turn = transcript.turnsById[turnId];
  if (!turn) {
    throw new Error(`missing test turn ${turnId}`);
  }
  for (let index = 0; index < count; index += 1) {
    const itemId = `item-${index}`;
    turn.itemOrder.push(itemId);
    transcript.itemsById[itemId] = {
      kind: "assistant_prose",
      itemId,
      turnId,
      text: `message ${index}`,
      isStreaming: false,
      startedSeq: index + 1,
    } as TranscriptState["itemsById"][string];
  }
}

function addUserItem(
  transcript: TranscriptState,
  turnId: string,
  itemId: string,
  text: string,
) {
  const turn = transcript.turnsById[turnId];
  if (!turn) {
    throw new Error(`missing test turn ${turnId}`);
  }
  turn.itemOrder.push(itemId);
  transcript.itemsById[itemId] = {
    kind: "user_message",
    itemId,
    turnId,
    text,
    isStreaming: false,
    startedSeq: 1,
  } as TranscriptState["itemsById"][string];
}

function pendingPrompt(): PendingPromptEntry {
  return {
    seq: 1,
    promptId: "prompt-1",
    text: "hello",
    contentParts: [],
    queuedAt: "2026-01-01T00:00:00.000Z",
    promptProvenance: null,
  };
}
