import { describe, expect, it } from "vitest";
import {
  createOptimisticPendingPrompt,
  hasVisibleTranscriptContent,
  resolveVisibleOptimisticPrompt,
  shouldClearOptimisticPromptAfterSessionSummary,
  shouldClearOptimisticPromptAfterPromptResponse,
  shouldClearOptimisticPendingPromptForEnvelope,
  shouldClearOptimisticPendingPrompt,
  shouldShowPendingPromptActivity,
  turnHasAssistantRenderableTranscriptContent,
  turnHasRenderableTranscriptContent,
} from "./pending-prompts";
import { createTranscriptState, type PendingPromptEntry, type SessionEventEnvelope } from "@anyharness/sdk";

function durablePendingPrompt(text = "Queued text"): PendingPromptEntry {
  return {
    seq: 7,
    promptId: "prompt-1",
    text,
    contentParts: [],
    queuedAt: "2026-04-13T12:00:01.000Z",
    promptProvenance: null,
  };
}

describe("pending prompt visibility", () => {
  it("treats an optimistic prompt as visible transcript content", () => {
    expect(hasVisibleTranscriptContent({
      transcript: createTranscriptState("session-1"),
      optimisticPrompt: createOptimisticPendingPrompt("Ship it", "prompt-1", "2026-04-13T12:00:00.000Z"),
    })).toBe(true);
  });

  it("does not treat durable queued prompts as visible transcript content", () => {
    const transcript = createTranscriptState("session-1");
    transcript.pendingPrompts = [durablePendingPrompt()];

    expect(hasVisibleTranscriptContent({
      transcript,
      optimisticPrompt: null,
    })).toBe(false);
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
      optimisticPrompt: null,
    })).toBe(false);
  });

  it("does not render durable queued prompts in the transcript selector", () => {
    expect(resolveVisibleOptimisticPrompt({
      optimisticPrompt: null,
      latestTurnStartedAt: null,
      latestTurnHasAssistantRenderableContent: false,
    })).toBeNull();
  });

  it("keeps an optimistic prompt visible until the newer turn has assistant content", () => {
    expect(resolveVisibleOptimisticPrompt({
      optimisticPrompt: createOptimisticPendingPrompt(
        "Ship it",
        "prompt-1",
        "2026-04-13T12:00:00.000Z",
      ),
      latestTurnStartedAt: "2026-04-13T12:00:01.000Z",
      latestTurnHasAssistantRenderableContent: false,
    })?.text).toBe("Ship it");
  });

  it("hides an optimistic prompt once a newer turn has assistant transcript content", () => {
    expect(resolveVisibleOptimisticPrompt({
      optimisticPrompt: createOptimisticPendingPrompt(
        "Ship it",
        "prompt-1",
        "2026-04-13T12:00:00.000Z",
      ),
      latestTurnStartedAt: "2026-04-13T12:00:01.000Z",
      latestTurnHasAssistantRenderableContent: true,
    })).toBeNull();
  });

  it("clears optimistic prompt after the runtime confirms a queued response", () => {
    expect(shouldClearOptimisticPromptAfterPromptResponse("queued")).toBe(true);
    expect(shouldClearOptimisticPromptAfterPromptResponse("running")).toBe(false);
  });

  it("clears optimistic prompt when a session summary reaches a terminal or idle state", () => {
    expect(shouldClearOptimisticPromptAfterSessionSummary("idle")).toBe(true);
    expect(shouldClearOptimisticPromptAfterSessionSummary("completed")).toBe(true);
    expect(shouldClearOptimisticPromptAfterSessionSummary("errored")).toBe(true);
    expect(shouldClearOptimisticPromptAfterSessionSummary("closed")).toBe(true);
    expect(shouldClearOptimisticPromptAfterSessionSummary("running")).toBe(false);
    expect(shouldClearOptimisticPromptAfterSessionSummary("starting")).toBe(false);
    expect(shouldClearOptimisticPromptAfterSessionSummary(null)).toBe(false);
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

  it("clears optimistic prompt once the stream echoes the submitted user message", () => {
    expect(shouldClearOptimisticPendingPromptForEnvelope({
      sessionId: "session-1",
      seq: 1,
      timestamp: "2026-04-13T12:00:01.000Z",
      turnId: "turn-1",
      itemId: "item-1",
      event: {
        type: "item_started",
        item: {
          kind: "user_message",
          status: "completed",
          sourceAgentKind: "codex",
          contentParts: [{ type: "text", text: "Ship it" }],
        },
      },
    } satisfies SessionEventEnvelope, createOptimisticPendingPrompt(
      "Ship it",
      "prompt-1",
      "2026-04-13T12:00:00.000Z",
    ))).toBe(true);
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
      optimisticPrompt: null,
    })).toBe(true);
  });
});
