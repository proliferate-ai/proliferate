import { describe, expect, it } from "vitest";
import { createTranscriptState, type PendingPromptEntry, type TranscriptState } from "@anyharness/sdk";
import {
  buildTranscriptRowModel,
  createTranscriptRowModelCache,
} from "@/lib/domain/chat/transcript-row-model";
import {
  shouldStickToVirtualBottom,
} from "@/lib/domain/chat/transcript-virtual-rows";

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
