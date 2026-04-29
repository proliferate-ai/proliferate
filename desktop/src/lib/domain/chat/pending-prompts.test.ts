import { describe, expect, it } from "vitest";
import {
  createOptimisticPendingPrompt,
  hasVisibleTranscriptContent,
  resolveVisibleTranscriptPendingPrompt,
  shouldClearOptimisticPendingPrompt,
  shouldShowPendingPromptActivity,
  turnHasAssistantRenderableTranscriptContent,
  turnHasRenderableTranscriptContent,
} from "./pending-prompts";
import { createTranscriptState } from "@anyharness/sdk";

describe("pending prompt visibility", () => {
  it("treats an optimistic prompt as visible transcript content", () => {
    expect(hasVisibleTranscriptContent({
      transcript: createTranscriptState("session-1"),
      pendingPrompts: [],
      optimisticPrompt: createOptimisticPendingPrompt("Ship it", "prompt-1", "2026-04-13T12:00:00.000Z"),
    })).toBe(true);
  });

  it("does not treat an empty turn as visible transcript content", () => {
    const transcript = createTranscriptState("session-1");
    transcript.turnOrder = ["turn-1"];
    transcript.turnsById["turn-1"] = {
      turnId: "turn-1",
      startedAt: "2026-04-13T12:00:01.000Z",
      completedAt: "2026-04-13T12:00:02.000Z",
      stopReason: null,
      itemOrder: [],
      fileBadges: [],
    };

    expect(hasVisibleTranscriptContent({
      transcript,
      pendingPrompts: [],
      optimisticPrompt: null,
    })).toBe(false);
  });

  it("prefers the latest authoritative pending prompt once it exists", () => {
    const optimisticPrompt = createOptimisticPendingPrompt(
      "Initial text",
      "prompt-1",
      "2026-04-13T12:00:00.000Z",
    );

    expect(resolveVisibleTranscriptPendingPrompt({
      optimisticPrompt,
      pendingPrompts: [
        {
          seq: 7,
          promptId: "prompt-1",
          text: "Authoritative text",
          contentParts: [],
          queuedAt: "2026-04-13T12:00:01.000Z",
        },
      ],
      latestTurnStartedAt: null,
      latestTurnHasAssistantRenderableContent: false,
    })?.text).toBe("Authoritative text");
  });

  it("keeps a pending prompt visible until the newer turn has assistant content", () => {
    expect(resolveVisibleTranscriptPendingPrompt({
      optimisticPrompt: createOptimisticPendingPrompt(
        "Ship it",
        "prompt-1",
        "2026-04-13T12:00:00.000Z",
      ),
      pendingPrompts: [],
      latestTurnStartedAt: "2026-04-13T12:00:01.000Z",
      latestTurnHasAssistantRenderableContent: false,
    })?.text).toBe("Ship it");
  });

  it("hides a pending prompt once a newer turn has assistant transcript content", () => {
    expect(resolveVisibleTranscriptPendingPrompt({
      optimisticPrompt: createOptimisticPendingPrompt(
        "Ship it",
        "prompt-1",
        "2026-04-13T12:00:00.000Z",
      ),
      pendingPrompts: [],
      latestTurnStartedAt: "2026-04-13T12:00:01.000Z",
      latestTurnHasAssistantRenderableContent: true,
    })).toBeNull();
  });

  it("keeps the activity indicator visible during the optimistic handoff", () => {
    expect(shouldShowPendingPromptActivity({
      optimisticPrompt: createOptimisticPendingPrompt(
        "Ship it",
        "prompt-1",
        "2026-04-13T12:00:00.000Z",
      ),
      sessionViewState: "idle",
    })).toBe(true);
  });

  it("clears the optimistic prompt once turn data starts arriving", () => {
    expect(shouldClearOptimisticPendingPrompt("turn_started")).toBe(false);
    expect(shouldClearOptimisticPendingPrompt("item_started")).toBe(false);
    expect(shouldClearOptimisticPendingPrompt("pending_prompt_removed")).toBe(false);
    expect(shouldClearOptimisticPendingPrompt("turn_ended")).toBe(true);
    expect(shouldClearOptimisticPendingPrompt("pending_prompt_added")).toBe(false);
  });

  it("treats plan-only turns as not yet renderable", () => {
    const transcript = createTranscriptState("session-1");
    transcript.turnOrder = ["turn-1"];
    transcript.turnsById["turn-1"] = {
      turnId: "turn-1",
      startedAt: "2026-04-13T12:00:01.000Z",
      completedAt: null,
      stopReason: null,
      itemOrder: ["item-1"],
      fileBadges: [],
    };
    transcript.itemsById["item-1"] = {
      kind: "plan",
      itemId: "item-1",
      turnId: "turn-1",
      status: "completed",
      sourceAgentKind: "codex",
      title: null,
      nativeToolName: null,
      parentToolCallId: null,
      rawInput: undefined,
      rawOutput: undefined,
      contentParts: [],
      timestamp: "2026-04-13T12:00:01.000Z",
      messageId: null,
      startedSeq: 1,
      lastUpdatedSeq: 1,
      completedSeq: 1,
      completedAt: "2026-04-13T12:00:01.000Z",
      entries: [],
    };

    expect(turnHasRenderableTranscriptContent(
      transcript.turnsById["turn-1"],
      transcript,
    )).toBe(false);
    expect(turnHasAssistantRenderableTranscriptContent(
      transcript.turnsById["turn-1"],
      transcript,
    )).toBe(false);
  });

  it("does not treat a user-message echo as assistant renderable content", () => {
    const transcript = createTranscriptState("session-1");
    transcript.turnOrder = ["turn-1"];
    transcript.turnsById["turn-1"] = {
      turnId: "turn-1",
      startedAt: "2026-04-13T12:00:01.000Z",
      completedAt: null,
      stopReason: null,
      itemOrder: ["item-1"],
      fileBadges: [],
    };
    transcript.itemsById["item-1"] = {
      kind: "user_message",
      itemId: "item-1",
      turnId: "turn-1",
      status: "completed",
      sourceAgentKind: "codex",
      title: null,
      nativeToolName: null,
      parentToolCallId: null,
      rawInput: undefined,
      rawOutput: undefined,
      contentParts: [],
      timestamp: "2026-04-13T12:00:01.000Z",
      messageId: null,
      startedSeq: 1,
      lastUpdatedSeq: 1,
      completedSeq: 1,
      completedAt: "2026-04-13T12:00:01.000Z",
      text: "Ship it",
      isStreaming: false,
    };

    expect(turnHasRenderableTranscriptContent(
      transcript.turnsById["turn-1"],
      transcript,
    )).toBe(true);
    expect(turnHasAssistantRenderableTranscriptContent(
      transcript.turnsById["turn-1"],
      transcript,
    )).toBe(false);
    expect(hasVisibleTranscriptContent({
      transcript,
      pendingPrompts: [],
      optimisticPrompt: null,
    })).toBe(true);
  });
});
