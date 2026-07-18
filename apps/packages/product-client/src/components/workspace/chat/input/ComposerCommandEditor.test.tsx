// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTextDraft,
  serializeChatDraftToPrompt,
  type ChatComposerDraft,
} from "#product/lib/domain/chat/composer/file-mention-draft-model";
import type { SessionSlashCommandViewModel } from "#product/lib/domain/chat/composer/session-slash-command-policy";
import { ComposerCommandEditor } from "#product/components/workspace/chat/input/ComposerCommandEditor";
import { isExactHttpsComposerPaste } from "#product/components/workspace/chat/input/ComposerRichTextEditor";

const slashCommandMock = vi.hoisted(() => ({
  commands: [] as SessionSlashCommandViewModel[],
  moveHighlight: vi.fn(),
  selectedCount: 0,
}));

vi.mock("#product/hooks/chat/ui/use-chat-slash-command-menu", () => ({
  useChatSlashCommandMenu: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (command: SessionSlashCommandViewModel) => void;
  }) => ({
    commands: open ? slashCommandMock.commands : [],
    highlightedIndex: 0,
    listRef: { current: null },
    moveHighlight: slashCommandMock.moveHighlight,
    selectHighlighted: () => {
      slashCommandMock.selectedCount += 1;
      const first = slashCommandMock.commands[0];
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
  const { container } = render(
    <ComposerCommandEditor
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
    container,
    onSubmit,
    onDraftChange,
    textarea: container.querySelector<HTMLElement>("[data-chat-composer-editor]")!,
  };
}

describe("ComposerCommandEditor", () => {

  beforeEach(() => {
    slashCommandMock.commands = [];
    slashCommandMock.moveHighlight.mockClear();
    slashCommandMock.selectedCount = 0;
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

  it("keeps Enter as slash command selection when a slash trigger is active", async () => {
    slashCommandMock.commands = [createSlashCommand("review", "Review the current changes")];
    const onSubmit = vi.fn();
    const onDraftChange = vi.fn();
    const { textarea } = renderEditor({
      draft: createTextDraft("/rev"),
      onSubmit,
      onDraftChange,
    });

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: true })).toBe(false);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(slashCommandMock.selectedCount).toBe(1);
    await waitFor(() => expect(onDraftChange).toHaveBeenCalledTimes(1));
    expect(serializeChatDraftToPrompt(onDraftChange.mock.calls[0]?.[0])).toBe("/review ");
  });

  it("uses the caret-local slash trigger without replacing trailing text", async () => {
    slashCommandMock.commands = [createSlashCommand("review", "Review the current changes")];
    const onDraftChange = vi.fn();
    const { container, textarea } = renderEditor({
      draft: createTextDraft("/rev trailing"),
      onDraftChange,
    });
    const textNode = textarea.querySelector("[data-lexical-text]")?.firstChild;
    expect(textNode).toBeTruthy();
    const range = document.createRange();
    range.setStart(textNode!, 4);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event("selectionchange"));
    await waitFor(() => expect(container.textContent).toContain("Review the current changes"));

    expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(false);

    await waitFor(() => expect(onDraftChange.mock.calls.some(
      ([draft]) => serializeChatDraftToPrompt(draft) === "/review trailing",
    )).toBe(true));
  });

  it("submits slash text when no slash command matches", () => {
    const { textarea, onSubmit, onDraftChange } = renderEditor({
      draft: createTextDraft("/unknown"),
    });

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: false })).toBe(false);

    expect(slashCommandMock.selectedCount).toBe(0);
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not treat @ text as a composer command trigger", () => {
    slashCommandMock.commands = [createSlashCommand("review", "Review the current changes")];
    const { textarea, onSubmit, onDraftChange } = renderEditor({
      draft: createTextDraft("Open @fi"),
    });

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: false })).toBe(false);

    expect(slashCommandMock.selectedCount).toBe(0);
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("renders emphasis and lists from canonical Markdown", () => {
    const { textarea } = renderEditor({
      draft: createTextDraft("*hello*\n\n- item"),
    });

    expect(textarea.querySelector(".italic")?.textContent).toBe("hello");
    expect(textarea.querySelector("ul li")?.textContent).toContain("item");
  });

  it("recognizes only exact HTTPS paste values and keeps typed Markdown links literal", () => {
    expect(isExactHttpsComposerPaste("https://example.com/path?q=1")).toBe(true);
    expect(isExactHttpsComposerPaste("http://example.com")).toBe(false);
    expect(isExactHttpsComposerPaste(" https://example.com")).toBe(false);
    expect(isExactHttpsComposerPaste("https://example.com extra")).toBe(false);

    const { textarea: typed } = renderEditor({
      draft: createTextDraft("[Docs](https://example.com)"),
    });
    expect(typed.querySelector("a")).toBeNull();
    expect(typed.textContent).toContain("[Docs](https://example.com)");
  });
});

function createSlashCommand(
  name: string,
  description: string,
): SessionSlashCommandViewModel {
  return {
    id: name,
    name,
    displayName: `/${name}`,
    description,
    inputHint: null,
    group: "Commands",
  };
}
