// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import type { TurnRecord } from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import { createOptimisticPendingPrompt } from "@proliferate/product-domain/chats/pending-prompts/pending-prompts";
import { describe, expect, it } from "vitest";
import { useOptimisticPromptHandoff } from "./useOptimisticPromptHandoff";

const LIVE_TURN: TurnRecord = {
  turnId: "turn-1",
  itemOrder: [],
  startedAt: "2026-04-13T12:00:01.000Z",
  completedAt: null,
  stopReason: null,
  fileBadges: [],
};

describe("useOptimisticPromptHandoff", () => {
  it("keeps one pending owner through the user echo and yields to assistant activity", () => {
    const prompt = createOptimisticPendingPrompt(
      "Ship it",
      "prompt-1",
      "2026-04-13T12:00:00.000Z",
    );
    let optimisticPrompt: ReturnType<typeof createOptimisticPendingPrompt> | null = prompt;
    let latestTurnHasAssistantRenderableContent = false;
    const { result, rerender } = renderHook(() => useOptimisticPromptHandoff({
      activeSessionId: "session-1",
      optimisticPrompt,
      latestTurn: LIVE_TURN,
      latestTurnHasAssistantRenderableContent,
      sessionViewState: "working",
    }));

    expect(result.current).toBe(prompt);

    optimisticPrompt = null;
    rerender();
    expect(result.current).toBe(prompt);

    latestTurnHasAssistantRenderableContent = true;
    rerender();
    expect(result.current).toBeNull();
  });

  it("never carries a retained prompt into another session", () => {
    const prompt = createOptimisticPendingPrompt("Ship it");
    let activeSessionId = "session-1";
    let optimisticPrompt: ReturnType<typeof createOptimisticPendingPrompt> | null = prompt;
    const { result, rerender } = renderHook(() => useOptimisticPromptHandoff({
      activeSessionId,
      optimisticPrompt,
      latestTurn: LIVE_TURN,
      latestTurnHasAssistantRenderableContent: false,
      sessionViewState: "working",
    }));

    optimisticPrompt = null;
    activeSessionId = "session-2";
    rerender();
    expect(result.current).toBeNull();
  });

  it("clears retained activity when a session becomes idle", () => {
    const prompt = createOptimisticPendingPrompt("Ship it");
    let optimisticPrompt: ReturnType<typeof createOptimisticPendingPrompt> | null = prompt;
    let sessionViewState: "working" | "idle" = "working";
    const { result, rerender } = renderHook(() => useOptimisticPromptHandoff({
      activeSessionId: "session-1",
      optimisticPrompt,
      latestTurn: LIVE_TURN,
      latestTurnHasAssistantRenderableContent: false,
      sessionViewState,
    }));

    optimisticPrompt = null;
    rerender();
    expect(result.current).toBe(prompt);

    sessionViewState = "idle";
    rerender();
    expect(result.current).toBeNull();
  });

  it("ignores assistant content from a turn that predates the new prompt", () => {
    const prompt = createOptimisticPendingPrompt(
      "Follow up",
      "prompt-2",
      "2026-04-13T12:01:00.000Z",
    );
    const previousTurn: TurnRecord = {
      ...LIVE_TURN,
      startedAt: "2026-04-13T12:00:00.000Z",
      completedAt: "2026-04-13T12:00:30.000Z",
    };
    let optimisticPrompt: ReturnType<typeof createOptimisticPendingPrompt> | null = prompt;
    const { result, rerender } = renderHook(() => useOptimisticPromptHandoff({
      activeSessionId: "session-1",
      optimisticPrompt,
      latestTurn: previousTurn,
      latestTurnHasAssistantRenderableContent: true,
      sessionViewState: "working",
    }));

    optimisticPrompt = null;
    rerender();
    expect(result.current).toBe(prompt);
  });
});
