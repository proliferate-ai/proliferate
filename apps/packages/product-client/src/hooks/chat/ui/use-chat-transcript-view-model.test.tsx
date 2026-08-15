// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { createTranscriptState, type TranscriptState } from "@anyharness/sdk";
import type { ChatTranscriptState } from "#product/domain/chats/transcript/chat-transcript-state";
import { useChatTranscriptViewModel } from "./use-chat-transcript-view-model";

function transcriptWithFirstExchange(): TranscriptState {
  const transcript = createTranscriptState("session-1");
  transcript.turnOrder.push("turn-1");
  transcript.turnsById["turn-1"] = {
    turnId: "turn-1",
    itemOrder: ["user-1", "assistant-1"],
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    stopReason: "stop",
    fileBadges: [],
  };
  transcript.itemsById["user-1"] = {
    kind: "user_message",
    itemId: "user-1",
    turnId: "turn-1",
    text: "make me a worktree",
    isStreaming: false,
    startedSeq: 1,
  } as TranscriptState["itemsById"][string];
  transcript.itemsById["assistant-1"] = {
    kind: "assistant_prose",
    itemId: "assistant-1",
    turnId: "turn-1",
    text: "done",
    isStreaming: false,
    startedSeq: 2,
  } as TranscriptState["itemsById"][string];
  return transcript;
}

function baseState(overrides: Partial<ChatTranscriptState> = {}): ChatTranscriptState {
  return {
    activeSessionId: "session-1",
    selectedWorkspaceId: "workspace-1",
    transcript: createTranscriptState("session-1"),
    sessionViewState: "idle",
    ...overrides,
  };
}

describe("useChatTranscriptViewModel workspace receipt gating", () => {
  it("hosts the receipt on the first turn's row when the full history is loaded", () => {
    const { result } = renderHook(() =>
      useChatTranscriptViewModel({
        state: baseState({
          workspaceReceiptKey: "workspace-1",
          transcript: transcriptWithFirstExchange(),
        }),
      }),
    );

    // The receipt folds into the first turn's row as a flag — it never gets
    // its own standalone row (the `workspace_receipt` row kind is gone).
    expect(result.current.virtualRows).toHaveLength(1);
    expect(result.current.virtualRows[0]).toEqual(expect.objectContaining({
      kind: "turn",
      isFirstTurnRow: true,
      hostsWorkspaceReceipt: true,
    }));
  });

  it("drops the receipt hosting while older history pages remain unloaded", () => {
    const { result } = renderHook(() =>
      useChatTranscriptViewModel({
        state: baseState({
          workspaceReceiptKey: "workspace-1",
          transcript: transcriptWithFirstExchange(),
          history: { hasOlderHistory: true },
        }),
      }),
    );

    expect(
      result.current.virtualRows.some((row) =>
        row.kind === "turn" && row.hostsWorkspaceReceipt
      ),
    ).toBe(false);
  });
});
