// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_SELECTED_RESPONSE_ACTIONS } from "#product/copy/chat/chat-copy";
import { useSelectedResponseActions } from "#product/hooks/chat/workflows/use-selected-response-actions";

const mocks = vi.hoisted(() => ({
  addSelectedResponseContext: vi.fn(() => ({ id: "annotation-1", ordinal: 1 })),
  setSelectedResponseContextComment: vi.fn(),
  currentSubmit: vi.fn(async () => true),
  requestFocus: vi.fn(),
  showToast: vi.fn(),
  submitDisabledReason: null as string | null,
}));

vi.mock("#product/stores/sessions/session-selection-store", () => ({
  useSessionSelectionStore: (selector: (state: unknown) => unknown) => selector({
    selectedLogicalWorkspaceId: "logical-workspace-1",
    selectedWorkspaceId: "workspace-1",
  }),
}));

vi.mock("#product/stores/chat/chat-input-store", () => ({
  useChatInputStore: (selector: (state: unknown) => unknown) => selector({
    addSelectedResponseContext: mocks.addSelectedResponseContext,
    setSelectedResponseContextComment: mocks.setSelectedResponseContextComment,
    requestFocus: mocks.requestFocus,
  }),
}));

vi.mock("#product/hooks/chat/workflows/use-chat-prompt-actions", () => ({
  useChatPromptActions: () => ({
    handleSubmit: mocks.currentSubmit,
    submitDisabledReason: mocks.submitDisabledReason,
  }),
}));

vi.mock("#product/stores/toast/toast-store", () => ({
  useToastStore: (selector: (state: unknown) => unknown) => selector({
    show: mocks.showToast,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.submitDisabledReason = null;
});

afterEach(cleanup);

describe("useSelectedResponseActions", () => {
  it("attaches the exact excerpt and reports the annotation without stealing focus", () => {
    const { result } = renderHook(() => useSelectedResponseActions());

    let added: { id: string; ordinal: number } | null = null;
    act(() => {
      added = result.current.addToChat("selected response");
    });

    expect(mocks.addSelectedResponseContext).toHaveBeenCalledWith(
      "logical-workspace-1",
      "selected response",
    );
    expect(added).toEqual({ id: "annotation-1", ordinal: 1 });
    // The annotation comment editor takes focus first; the composer is only
    // focused through focusComposer once the comment settles.
    expect(mocks.requestFocus).not.toHaveBeenCalled();
  });

  it("routes annotation comments to the current workspace", () => {
    const { result } = renderHook(() => useSelectedResponseActions());

    act(() => result.current.setAnnotationComment("annotation-1", "note"));
    act(() => result.current.focusComposer());

    expect(mocks.setSelectedResponseContextComment).toHaveBeenCalledWith(
      "logical-workspace-1",
      "annotation-1",
      "note",
    );
    expect(mocks.requestFocus).toHaveBeenCalledOnce();
  });

  it("routes more details to the current chat without disturbing its draft", () => {
    const { result } = renderHook(() => useSelectedResponseActions());

    act(() => result.current.moreDetails("current-chat excerpt"));

    expect(mocks.currentSubmit).toHaveBeenCalledOnce();
    expectSubmittedExcerpt(
      mocks.currentSubmit,
      CHAT_SELECTED_RESPONSE_ACTIONS.moreDetailsPrompt,
      "current-chat excerpt",
    );
  });

  it("explains when an immediate response action is blocked", async () => {
    mocks.currentSubmit.mockResolvedValueOnce(false);
    mocks.submitDisabledReason = "Resolve workspace setup before sending.";
    const { result } = renderHook(() => useSelectedResponseActions());

    act(() => result.current.moreDetails("blocked excerpt"));

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith(
        "Resolve workspace setup before sending.",
      );
    });
  });
});

function expectSubmittedExcerpt(
  submit: ReturnType<typeof vi.fn>,
  prompt: string,
  excerpt: string,
) {
  const payload = submit.mock.calls[0]![0] as {
    text: string;
    blocks: Array<{ type: "text"; text: string }>;
    optimisticContentParts: Array<{ type: "text"; text: string }>;
    preserveDraft: boolean;
  };
  expect(payload.text.startsWith(prompt)).toBe(true);
  expect(payload.text.split(excerpt)).toHaveLength(2);
  expect(payload.blocks).toEqual([{ type: "text", text: payload.text }]);
  expect(payload.optimisticContentParts).toEqual([{ type: "text", text: payload.text }]);
  expect(payload.preserveDraft).toBe(true);
}
