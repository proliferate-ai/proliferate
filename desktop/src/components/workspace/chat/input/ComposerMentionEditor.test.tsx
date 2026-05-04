// @vitest-environment jsdom

import type { SearchWorkspaceFilesResponse } from "@anyharness/sdk";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTextDraft,
  serializeChatDraftToPrompt,
  type ChatComposerDraft,
} from "@/lib/domain/chat/file-mentions";
import { ComposerMentionEditor } from "./ComposerMentionEditor";

type FileSearchResult = SearchWorkspaceFilesResponse["results"][number];

const mentionSearchMock = vi.hoisted(() => ({
  results: [] as FileSearchResult[],
  moveHighlight: vi.fn(),
  selectedCount: 0,
}));

vi.mock("@/hooks/chat/use-chat-file-mention-search", () => ({
  useChatFileMentionSearch: ({ onSelect }: { onSelect: (result: FileSearchResult) => void }) => ({
    results: mentionSearchMock.results,
    highlightedIndex: 0,
    isLoading: false,
    errorMessage: null,
    listRef: { current: null },
    moveHighlight: mentionSearchMock.moveHighlight,
    selectHighlighted: () => {
      mentionSearchMock.selectedCount += 1;
      const first = mentionSearchMock.results[0];
      if (first) {
        onSelect(first);
      }
    },
    setRowRef: vi.fn(),
    handleRowMouseEnter: vi.fn(),
  }),
}));

function renderEditor({
  draft = createTextDraft("hello"),
  canSubmit = true,
  onSubmit = vi.fn(),
  onDraftChange = vi.fn(),
}: {
  draft?: ChatComposerDraft;
  canSubmit?: boolean;
  onSubmit?: () => void;
  onDraftChange?: (draft: ChatComposerDraft) => void;
} = {}) {
  render(
    <ComposerMentionEditor
      draft={draft}
      onDraftChange={onDraftChange}
      placeholder="Message"
      canSubmit={canSubmit}
      disabled={false}
      onSubmit={onSubmit}
      topInset="standard"
    />,
  );
  return {
    onSubmit,
    onDraftChange,
    textarea: screen.getByPlaceholderText("Message"),
  };
}

describe("ComposerMentionEditor", () => {
  beforeEach(() => {
    mentionSearchMock.results = [];
    mentionSearchMock.moveHighlight.mockClear();
    mentionSearchMock.selectedCount = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it("prevents repeated raw Enter fallback without submitting", () => {
    const { textarea, onSubmit } = renderEditor();

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: true })).toBe(false);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits on a non-repeated raw Enter fallback", () => {
    const { textarea, onSubmit } = renderEditor();

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: false })).toBe(false);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps Enter as mention selection when a mention trigger is active", () => {
    mentionSearchMock.results = [{
      name: "file.ts",
      path: "src/file.ts",
    } as FileSearchResult];
    const onSubmit = vi.fn();
    const onDraftChange = vi.fn();
    const { textarea } = renderEditor({
      draft: createTextDraft("Open @fi"),
      onSubmit,
      onDraftChange,
    });

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: true })).toBe(false);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(mentionSearchMock.selectedCount).toBe(1);
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    expect(serializeChatDraftToPrompt(onDraftChange.mock.calls[0]?.[0])).toBe(
      "Open [file.ts](src/file.ts) ",
    );
  });
});
