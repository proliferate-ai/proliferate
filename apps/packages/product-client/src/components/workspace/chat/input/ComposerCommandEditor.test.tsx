// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
  isComposerMarkdownCodeBlockPaste,
  isComposerMarkdownListPaste,
  isExactHttpsComposerPaste,
} from "#product/components/workspace/chat/input/ComposerLinkPastePlugin";

const slashCommandMock = vi.hoisted(() => ({
  commands: [] as SessionSlashCommandViewModel[],
  moveHighlight: vi.fn(),
  selectedCount: 0,
}));

type MentionMenuItem =
  | { kind: "file"; file: { path: string; name: string; parent: string } }
  | {
      kind: "contextDoc";
      doc: { docId: string; runId: string; slug: string; filename: string; runLabel: string | null };
    };

const fileMentionMock = vi.hoisted(() => ({
  items: [] as MentionMenuItem[],
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
    onSelect: (item: MentionMenuItem) => void;
  }) => {
    if (open) {
      fileMentionMock.lastQuery = query;
    }
    return {
      items: open ? fileMentionMock.items : [],
      isLoading: false,
      isError: false,
      isPending: false,
      runtimeReady: true,
      highlightedIndex: 0,
      listRef: { current: null },
      moveHighlight: fileMentionMock.moveHighlight,
      selectHighlighted: () => {
        fileMentionMock.selectedCount += 1;
        const first = fileMentionMock.items[0];
        if (first) {
          onSelect(first);
        }
      },
      setRowRef: vi.fn(),
      handleRowMouseEnter: vi.fn(),
      getRowId: (index: number) => `file-mention-row-${index}`,
      activeDescendantId: open && fileMentionMock.items.length > 0 ? "file-mention-row-0" : undefined,
    };
  },
}));

function fileItem(file: { path: string; name: string; parent: string }): MentionMenuItem {
  return { kind: "file", file };
}

function docMentionItem(): MentionMenuItem {
  return {
    kind: "contextDoc",
    doc: {
      docId: "doc-1",
      runId: "run-01j8",
      slug: "plan",
      filename: "01-plan.md",
      runLabel: "Release checklist",
    },
  };
}

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
    getRowId: (index: number) => `slash-command-row-${index}`,
    activeDescendantId: open && slashCommandMock.commands.length > 0 ? "slash-command-row-0" : undefined,
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
    fileMentionMock.items = [];
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
    fileMentionMock.items = [
      fileItem({ path: "docs/setup.md", name: "setup.md", parent: "docs" }),
    ];
    const { container } = renderEditor({ draft: createTextDraft("Open @set") });

    await waitFor(() => expect(container.textContent).toContain("setup.md"));
    expect(fileMentionMock.lastQuery).toBe("set");
    expect(container.textContent).toContain("docs");
  });

  it("wires the file mention menu as a listbox announced from the composer's editable", async () => {
    fileMentionMock.items = [
      fileItem({ path: "docs/setup.md", name: "setup.md", parent: "docs" }),
    ];
    const { container, textarea } = renderEditor({ draft: createTextDraft("Open @set") });

    await waitFor(() => expect(container.textContent).toContain("setup.md"));

    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();
    const option = container.querySelector('[role="option"]');
    expect(option).toBeTruthy();
    expect(option?.getAttribute("aria-selected")).toBe("true");
    // Focus stays in the composer while the menu is open, so the highlighted
    // row is announced via aria-activedescendant rather than native focus.
    expect(textarea.getAttribute("aria-activedescendant")).toBe(option?.id);
  });

  it("does not set aria-activedescendant when no menu is open", () => {
    const { textarea } = renderEditor({ draft: createTextDraft("hello") });

    expect(textarea.hasAttribute("aria-activedescendant")).toBe(false);
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
    fileMentionMock.items = [
      fileItem({ path: "docs/setup.md", name: "setup.md", parent: "docs" }),
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
    fileMentionMock.items = [
      fileItem({ path: "docs/setup.md", name: "setup.md", parent: "docs" }),
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
    fileMentionMock.items = [
      fileItem({ path: "docs/guides/setup.md", name: "setup.md", parent: "docs/guides" }),
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

  it("inserts a selected context doc serialized to the @doc token", async () => {
    fileMentionMock.items = [docMentionItem()];
    const onSubmit = vi.fn();
    const onDraftChange = vi.fn();
    const { textarea } = renderEditor({
      draft: createTextDraft("Open @pla"),
      onSubmit,
      onDraftChange,
    });

    expect(fireEvent.keyDown(textarea, { key: "Enter", repeat: false })).toBe(false);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(fileMentionMock.selectedCount).toBe(1);
    await waitFor(() => expect(onDraftChange.mock.calls.some(
      ([draft]) => serializeChatDraftToPrompt(draft)
        === "Open [01-plan.md](@doc:run-01j8/01-plan.md) ",
    )).toBe(true));
  });

  it("renders an inserted context-doc mention as a chip with the resolved path tooltip", async () => {
    fileMentionMock.items = [docMentionItem()];
    const { textarea } = renderEditor({ draft: createTextDraft("Open @pla") });

    fireEvent.keyDown(textarea, { key: "Enter", repeat: false });

    await waitFor(() => {
      expect(textarea.querySelector("[data-composer-context-doc-mention]")).toBeTruthy();
    });
    const chip = textarea.querySelector<HTMLElement>("[data-composer-context-doc-mention]")!;
    expect(chip.getAttribute("data-composer-context-doc-mention")).toBe("run-01j8/01-plan.md");
    // The tooltip carries the workspace path the mention resolves to at send
    // time, not the raw token.
    expect(chip.title).toBe(".proliferate/context/01-plan.md");
    const glyph = chip.querySelector("[data-composer-context-doc-mention-glyph]");
    expect(glyph?.querySelector("svg")).toBeTruthy();
    expect(glyph?.textContent).toBe("");
    expect(chip.textContent).toBe("01-plan.md");
    expect(textarea.textContent).not.toContain("](");
  });

  it("renders a restored draft's @doc token as a context-doc chip", () => {
    const { textarea } = renderEditor({
      draft: createTextDraft("See [01-plan.md](@doc:run-01j8/01-plan.md) please"),
    });

    const chip = textarea.querySelector<HTMLElement>("[data-composer-context-doc-mention]")!;
    expect(chip.getAttribute("data-composer-context-doc-mention")).toBe("run-01j8/01-plan.md");
    expect(chip.textContent).toBe("01-plan.md");
    // Only the chip's own text may reach the draft's text stream.
    expect(textarea.textContent).toBe("See 01-plan.md please");
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

  it("keeps inline command discovery closed while editing a code block", async () => {
    slashCommandMock.commands = [createSlashCommand("review", "Review the current changes")];
    const onSubmit = vi.fn();
    const { container, textarea } = renderEditor({
      draft: createTextDraft("```\n/rev\n```"),
      onSubmit,
    });
    const textNode = textarea.querySelector("code [data-lexical-text]")?.firstChild;
    expect(textNode).toBeTruthy();
    const range = document.createRange();
    range.setStart(textNode!, 4);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    await act(async () => {
      fireEvent(document, new Event("selectionchange"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(container.textContent).not.toContain("Review the current changes");
    });
    expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(false);
    expect(slashCommandMock.selectedCount).toBe(0);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("replaces a file trigger after a code block without shifting its range", async () => {
    fileMentionMock.items = [
      fileItem({ path: "docs/setup.md", name: "setup.md", parent: "docs" }),
    ];
    const onDraftChange = vi.fn();
    const { textarea } = renderEditor({
      draft: createTextDraft("```\nconst ready = true;\n```\n\n@set"),
      onDraftChange,
    });
    const textNode = textarea.querySelector("p [data-lexical-text]")?.firstChild;
    expect(textNode?.textContent).toBe("@set");
    const range = document.createRange();
    range.setStart(textNode!, 4);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    await act(async () => {
      fireEvent(document, new Event("selectionchange"));
      await Promise.resolve();
    });

    await waitFor(() => expect(fileMentionMock.lastQuery).toBe("set"));
    fireEvent.keyDown(textarea, { key: "Enter", repeat: false });
    await waitFor(() => expect(onDraftChange.mock.calls.some(
      ([draft]) => serializeChatDraftToPrompt(draft)
        === "```\nconst ready = true;\n```\n\n[setup.md](docs/setup.md) ",
    )).toBe(true));
  });

  it("replaces a file trigger before a code block without consuming the block", async () => {
    fileMentionMock.items = [
      fileItem({ path: "docs/setup.md", name: "setup.md", parent: "docs" }),
    ];
    const onDraftChange = vi.fn();
    const { textarea } = renderEditor({
      draft: createTextDraft("@set\n\n```\nconst ready = true;\n```"),
      onDraftChange,
    });
    const textNode = textarea.querySelector("p [data-lexical-text]")?.firstChild;
    expect(textNode?.textContent).toBe("@set");
    const range = document.createRange();
    range.setStart(textNode!, 4);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    await act(async () => {
      fireEvent(document, new Event("selectionchange"));
      await Promise.resolve();
    });

    await waitFor(() => expect(fileMentionMock.lastQuery).toBe("set"));
    fireEvent.keyDown(textarea, { key: "Enter", repeat: false });
    // The document ends with a code block, so the fenced-code plugin keeps a
    // continuation paragraph after it — serialized as the trailing newline.
    await waitFor(() => expect(onDraftChange.mock.calls.some(
      ([draft]) => serializeChatDraftToPrompt(draft)
        === "[setup.md](docs/setup.md) \n\n```\nconst ready = true;\n```\n",
    )).toBe(true));
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
    expect(isComposerMarkdownCodeBlockPaste("```\nconst ready = true;\n```")).toBe(true);
    expect(isComposerMarkdownCodeBlockPaste("```ts\nconst ready = true;\n````")).toBe(true);
    expect(isComposerMarkdownCodeBlockPaste("```c++\nconst ready = true;\n```")).toBe(true);
    expect(isComposerMarkdownCodeBlockPaste("```python linenos\nprint('ok')\n```")).toBe(true);
    expect(isComposerMarkdownCodeBlockPaste("````\nconst ready = true;\n```")).toBe(false);
    expect(isComposerMarkdownCodeBlockPaste("```\nconst ready = true;")).toBe(false);
    expect(isComposerMarkdownCodeBlockPaste("```const ready = true;```")).toBe(false);
    expect(isComposerFormattedPaste("- first")).toBe(true);
    expect(isComposerFormattedPaste("```\nconst ready = true;\n```")).toBe(true);
    expect(isComposerFormattedPaste("```\nconst ready = true;")).toBe(true);

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
