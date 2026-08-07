// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { createTranscriptState } from "@anyharness/sdk";
import type { ChatTranscriptState } from "#product/domain/chats/transcript/chat-transcript-state";
import { useChatTranscriptViewModel } from "./use-chat-transcript-view-model";

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
  it("emits the receipt row when the full history is loaded", () => {
    const { result } = renderHook(() =>
      useChatTranscriptViewModel({
        state: baseState({ workspaceReceiptKey: "workspace-1" }),
      }),
    );

    expect(result.current.virtualRows[0]).toEqual(expect.objectContaining({
      kind: "workspace_receipt",
      key: "workspace-receipt:workspace-1",
    }));
  });

  it("drops the receipt row while older history pages remain unloaded", () => {
    const { result } = renderHook(() =>
      useChatTranscriptViewModel({
        state: baseState({
          workspaceReceiptKey: "workspace-1",
          history: { hasOlderHistory: true },
        }),
      }),
    );

    expect(
      result.current.virtualRows.some((row) => row.kind === "workspace_receipt"),
    ).toBe(false);
  });
});
