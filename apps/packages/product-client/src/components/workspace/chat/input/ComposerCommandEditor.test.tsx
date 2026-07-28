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
import {
  isComposerFormattedPaste,
  isComposerLinkPaste,
  isComposerMarkdownListPaste,
  isExactHttpsComposerPaste,
} from "#product/components/workspace/chat/input/ComposerLinkPastePlugin";

const slashCommandMock = vi.hoisted(() => ({
  commands: [] as SessionSlashCommandViewModel[],
  moveHighlight: vi.fn(),
  selectedCount: 0,
}));

const fileMentionMock = vi.hoisted(() => ({
  results: [] as Array<{ path: string; name: string; parent: string }>,
  moveHighlight: vi.fn(),
  selectedCount: 0,
  lastQuery: null as string | null,
}));

vi.mock("#product/hooks/chat/ui/use-chat-file-mention-menu", () => ({
  useChatFileMentionMenu: ({
    open,
    query,
    onSelect,
  }: {
    open: boolean;
    query: string;
    onSelect: (result: { path: string; name: string; parent: string }) => void;
  }) => {
    if (open) {
      fileMentionMock.lastQuery = query;
    }
    return {
      results: open ? fileMentionMock.results : [],
      isLoading: false,
      isError: false,
      isPending: false,
      runtimeReady: true,
      highlightedIndex: 0,
      listRef: { current: null },
      moveHighlight: fileMentionMock.moveHighlight,
      selectHighlighted: () => {
        fileMentionMock.selectedCount += 1;
        const first = fileMentionMock.results[0];
        if (first) {
          onSelect(first);
        }
      },
      setRowRef: vi.fn(),
      handleRowMouseEnter: vi.fn(),
    };
  },
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
    fileMentionMock.results = [];
    fileMentionMock.moveHighlight.mockClear();
    fileMentionMock.selectedCount = 0;
    fileMentionMock.lastQuery = null;
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

  it("does not treat @ text as a slash command trigger", () => {
    slashCommandMock.commands = [createSlashCommand("review", "Review the current changes")];
    const { textarea, onSubmit, onDraftChange } = renderEditor({
      draft: createTextDraft("Open @fi"),
    });

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: false })).toBe(false);

    expect(slashCommandMock.selectedCount).toBe(0);
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("opens the file mention menu on an @ token and searches on the typed query", async () => {
    fileMentionMock.results = [
      { path: "docs/setup.md", name: "setup.md", parent: "docs" },
    ];
    const { container } = renderEditor({ draft: createTextDraft("Open @set") });

    await waitFor(() => expect(container.textContent).toContain("setup.md"));
    expect(fileMentionMock.lastQuery).toBe("set");
    expect(container.textContent).toContain("docs");
  });

  it("submits instead of completing when no file matches the mention query", () => {
    const { textarea, onSubmit, onDraftChange } = renderEditor({
      draft: createTextDraft("Open @nope"),
    });

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: false })).toBe(false);

    expect(fileMentionMock.selectedCount).toBe(0);
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("inserts a selected file mention as a markdown file link", async () => {
    fileMentionMock.results = [
      { path: "docs/setup.md", name: "setup.md", parent: "docs" },
    ];
    const onSubmit = vi.fn();
    const onDraftChange = vi.fn();
    const { textarea } = renderEditor({
      draft: createTextDraft("Open @set"),
      onSubmit,
      onDraftChange,
    });

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: false })).toBe(false);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(fileMentionMock.selectedCount).toBe(1);
    await waitFor(() => expect(onDraftChange.mock.calls.some(
      ([draft]) => serializeChatDraftToPrompt(draft) === "Open [setup.md](docs/setup.md) ",
    )).toBe(true));
  });

  it("renders an inserted file mention as a chip rather than raw markdown", async () => {
    fileMentionMock.results = [
      { path: "docs/setup.md", name: "setup.md", parent: "docs" },
    ];
    const { textarea } = renderEditor({ draft: createTextDraft("Open @set") });

    fireEvent.keyDown(textarea, { key: "Enter", repeat: false });

    await waitFor(() => {
      const chip = textarea.querySelector("[data-composer-file-mention]");
      expect(chip?.getAttribute("data-composer-file-mention")).toBe("docs/setup.md");
      expect(chip?.textContent).toBe("setup.md");
    });
    expect(textarea.textContent).not.toContain("](");
  });

  it("renders an inserted file mention with its file glyph and path", async () => {
    fileMentionMock.results = [
      { path: "docs/guides/setup.md", name: "setup.md", parent: "docs/guides" },
    ];
    const { textarea } = renderEditor({ draft: createTextDraft("Open @set") });

    fireEvent.keyDown(textarea, { key: "Enter", repeat: false });

    await waitFor(() => {
      expect(textarea.querySelector("[data-composer-file-mention]")).toBeTruthy();
    });
    const chip = textarea.querySelector<HTMLElement>("[data-composer-file-mention]")!;
    // The path is the link target: machine-readable on the chip and on hover.
    expect(chip.getAttribute("data-composer-file-mention")).toBe("docs/guides/setup.md");
    expect(chip.title).toBe("docs/guides/setup.md");
    // The glyph comes from the shared extension table, so a .md chip carries a
    // real mark rather than a generic one, and contributes no text.
    const glyph = chip.querySelector("[data-composer-file-mention-glyph]");
    expect(glyph?.querySelector("svg")).toBeTruthy();
    expect(glyph?.textContent).toBe("");
    // The directory is painted next to the basename, and the basename is still
    // the whole of the node's text.
    const content = chip.querySelector("[data-composer-file-mention-content]");
    expect(content?.getAttribute("data-composer-file-mention-directory")).toBe("docs/guides");
    expect(chip.textContent).toBe("setup.md");
  });

  it("renders a workspace file link from restored draft markdown as a chip", () => {
    const { textarea } = renderEditor({
      draft: createTextDraft("See [setup.md](docs/setup.md) please"),
    });

    const chip = textarea.querySelector<HTMLElement>("[data-composer-file-mention]")!;
    expect(chip.getAttribute("data-composer-file-mention")).toBe("docs/setup.md");
    expect(chip.title).toBe("docs/setup.md");
    expect(chip.querySelector("[data-composer-file-mention-glyph] svg")).toBeTruthy();
    expect(
      chip
        .querySelector("[data-composer-file-mention-content]")
        ?.getAttribute("data-composer-file-mention-directory"),
    ).toBe("docs");
    expect(chip.textContent).toBe("setup.md");
    // Neither the glyph nor the painted directory may leak into the draft's
    // text: the caret, selection, and markdown export all read this.
    expect(textarea.textContent).toBe("See setup.md please");
  });

  it("renders emphasis and lists from canonical Markdown", () => {
    const { textarea } = renderEditor({
      draft: createTextDraft("*hello*\n\n- item"),
    });

    expect(textarea.querySelector(".italic")?.textContent).toBe("hello");
    expect(textarea.querySelector("ul li")?.textContent).toContain("item");
  });

  it("recognizes exact HTTPS URLs and complete pasted Markdown HTTPS links", () => {
    expect(isExactHttpsComposerPaste("https://example.com/path?q=1")).toBe(true);
    expect(isExactHttpsComposerPaste("http://example.com")).toBe(false);
    expect(isExactHttpsComposerPaste(" https://example.com")).toBe(false);
    expect(isExactHttpsComposerPaste("https://example.com extra")).toBe(false);
    expect(isComposerLinkPaste("[Docs](https://example.com)")).toBe(true);
    expect(isComposerLinkPaste("See [Docs](https://example.com) now")).toBe(true);
    expect(isComposerLinkPaste("[Docs](https://example.com")).toBe(false);
    expect(isComposerLinkPaste("[Docs](http://example.com)")).toBe(false);
    expect(isComposerMarkdownListPaste("- first\n- second")).toBe(true);
    expect(isComposerMarkdownListPaste("1. first\n2. second")).toBe(true);
    expect(isComposerMarkdownListPaste("a hyphen - inside prose")).toBe(false);
    expect(isComposerMarkdownListPaste("-")).toBe(false);
    expect(isComposerFormattedPaste("- first")).toBe(true);

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
