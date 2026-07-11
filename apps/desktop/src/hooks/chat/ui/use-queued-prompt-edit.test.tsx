// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingPromptEntry } from "@anyharness/sdk";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import {
  useEditLastQueuedPrompt,
  useQueuedPromptEdit,
} from "./use-queued-prompt-edit";

const mocks = vi.hoisted(() => ({
  activeSessionId: "session-1" as string | null,
  editPendingPrompt: vi.fn(),
  pendingPrompts: [] as PendingPromptEntry[],
  showToast: vi.fn(),
}));

vi.mock("@/hooks/chat/derived/use-active-session-identity", () => ({
  useActiveSessionId: () => mocks.activeSessionId,
}));

vi.mock("@/hooks/chat/derived/use-active-pending-session-interactions", () => ({
  useActivePendingPrompts: () => mocks.pendingPrompts,
}));

vi.mock("@/hooks/sessions/workflows/use-edit-pending-prompt", () => ({
  useEditPendingPrompt: () => mocks.editPendingPrompt,
}));

vi.mock("@/stores/sessions/session-intent-store", () => ({
  useSessionIntentStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: { show: (message: string) => void }) => unknown) =>
    selector({ show: mocks.showToast }),
}));

function prompt(seq: number, text: string): PendingPromptEntry {
  return {
    seq,
    promptId: null,
    text,
    contentParts: [],
    queuedAt: "2026-07-11T00:00:00Z",
  };
}

describe("queued prompt editing", () => {
  beforeEach(() => {
    mocks.activeSessionId = "session-1";
    mocks.editPendingPrompt.mockReset().mockResolvedValue(undefined);
    mocks.pendingPrompts = [];
    mocks.showToast.mockReset();
    useChatInputStore.setState({
      draftByWorkspaceId: {},
      editDraftBySessionId: {},
      editingQueueSeqBySessionId: {},
      focusRequestNonce: 0,
    });
  });

  afterEach(() => cleanup());

  it("ArrowUp skips the newest protected row and edits the newest eligible seq", () => {
    mocks.pendingPrompts = [
      prompt(10, "editable message"),
      {
        ...prompt(20, "protected wake"),
        promptProvenance: {
          type: "subagentWake",
          sessionLinkId: "link-1",
          completionId: "completion-1",
          label: "reviewer",
        },
      },
    ];
    const { result } = renderHook(() => useEditLastQueuedPrompt(false));

    act(() => result.current?.());

    expect(useChatInputStore.getState().editingQueueSeqBySessionId["session-1"]).toBe(10);
    expect(useChatInputStore.getState().editDraftBySessionId["session-1"])
      .toBe("editable message");
  });

  it("revalidates eligibility at commit and cancels an edit that became protected", async () => {
    mocks.pendingPrompts = [prompt(10, "editable message")];
    useChatInputStore.getState().setEditingQueueSeq("session-1", 10);
    useChatInputStore.getState().setEditDraft("session-1", "changed text");
    const rendered = renderHook(() => useQueuedPromptEdit());

    mocks.pendingPrompts = [{
      ...prompt(10, "editable message"),
      promptProvenance: {
        type: "subagentWake",
        sessionLinkId: "link-1",
        completionId: "completion-1",
        label: "reviewer",
      },
    }];
    rendered.rerender();

    await act(async () => rendered.result.current.commitEdit());

    expect(mocks.editPendingPrompt).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith(
      "This queued message can no longer be edited.",
    );
    expect(useChatInputStore.getState().editingQueueSeqBySessionId["session-1"])
      .toBeUndefined();
    expect(useChatInputStore.getState().editDraftBySessionId["session-1"])
      .toBeUndefined();
  });
});
