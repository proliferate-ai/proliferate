// @vitest-environment jsdom

// List-exit behavior for PRO-267: Shift+Tab outdents top-level list items
// into paragraphs, and Shift+Enter exits the list from an empty item or an
// empty trailing line. Lives beside ComposerRichTextEditor.test.tsx, which is
// at the max-lines budget.

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { $isListItemNode, type ListItemNode } from "@lexical/list";
import {
  ComposerRichTextEditor,
  type ComposerRichTextEditorProps,
} from "#product/components/workspace/chat/input/ComposerRichTextEditor";

let originalRangeRectDescriptor: PropertyDescriptor | undefined;

afterEach(() => {
  cleanup();
  if (originalRangeRectDescriptor === undefined) {
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  } else {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", originalRangeRectDescriptor);
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  originalRangeRectDescriptor = Object.getOwnPropertyDescriptor(
    Range.prototype,
    "getBoundingClientRect",
  );
  // jsdom ranges have no geometry; the caret plugin measures on every
  // selection change and must not throw mid-update.
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 0, height: 0, left: 0, right: 0, toJSON: () => ({}), top: 0, width: 0, x: 0, y: 0,
    }),
  });
  vi.stubGlobal("DragEvent", class DragEvent extends Event {});
  vi.stubGlobal("ClipboardEvent", class ClipboardEvent extends Event {});
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
});

describe("composer list exit", () => {
  it("converts a top-level list item to a paragraph on Shift+Tab", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ onChange });
    await harness.ready();
    act(() => resetEditor(harness.editor));
    act(() => { fireEvent(harness.root, pasteEvent("- one\n- two")); });
    await waitFor(() => expect(harness.root.querySelectorAll("ul li")).toHaveLength(2));

    // Selection updates and the command must share one act() block: between
    // blocks, jsdom selection reconciliation resets the editor selection.
    act(() => {
      selectEndOfText(harness.editor, "two");
      harness.editor.dispatchCommand(KEY_TAB_COMMAND, keyEvent("Tab", { shiftKey: true }));
    });

    await waitFor(() => expect(harness.root.querySelectorAll("ul li")).toHaveLength(1));
    expect(harness.root.querySelector("ul li")?.textContent).toBe("one");
    expect(harness.root.querySelector("p:last-child")?.textContent).toBe("two");
    expect(lastMarkdown(onChange)).toBe("- one\n\ntwo");
  });

  it("splits the list around a middle item outdented with Shift+Tab", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ onChange });
    await harness.ready();
    act(() => resetEditor(harness.editor));
    act(() => { fireEvent(harness.root, pasteEvent("- a\n- b\n- c")); });
    await waitFor(() => expect(harness.root.querySelectorAll("ul li")).toHaveLength(3));

    act(() => {
      selectEndOfText(harness.editor, "b");
      harness.editor.dispatchCommand(KEY_TAB_COMMAND, keyEvent("Tab", { shiftKey: true }));
    });

    await waitFor(() => expect(harness.root.querySelectorAll("ul")).toHaveLength(2));
    const lists = harness.root.querySelectorAll("ul");
    expect(lists[0]?.textContent).toBe("a");
    expect(lists[1]?.textContent).toBe("c");
    expect(lastMarkdown(onChange)).toBe("- a\n\nb\n\n- c");
  });

  it("keeps ordered numbering continuous when a middle item exits", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ onChange });
    await harness.ready();
    act(() => resetEditor(harness.editor));
    act(() => { fireEvent(harness.root, pasteEvent("1. a\n2. b\n3. c")); });
    await waitFor(() => expect(harness.root.querySelectorAll("ol li")).toHaveLength(3));

    act(() => {
      selectEndOfText(harness.editor, "b");
      harness.editor.dispatchCommand(KEY_TAB_COMMAND, keyEvent("Tab", { shiftKey: true }));
    });

    await waitFor(() => expect(harness.root.querySelectorAll("ol")).toHaveLength(2));
    const lists = harness.root.querySelectorAll("ol");
    expect(lists[1]?.getAttribute("start")).toBe("3");
    expect(lastMarkdown(onChange)).toBe("1. a\n\nb\n\n3. c");
  });

  it("promotes an orphaned sublist when its parent item exits", async () => {
    const harness = renderEditor();
    await harness.ready();
    act(() => resetEditor(harness.editor));
    act(() => { fireEvent(harness.root, pasteEvent("- parent\n- child")); });
    await waitFor(() => expect(harness.root.querySelectorAll("ul li")).toHaveLength(2));
    act(() => {
      selectEndOfText(harness.editor, "child");
      harness.editor.dispatchCommand(KEY_TAB_COMMAND, keyEvent("Tab"));
    });
    await waitFor(() => expect(harness.root.querySelector("ul ul")).toBeTruthy());

    act(() => {
      selectEndOfText(harness.editor, "parent");
      harness.editor.dispatchCommand(KEY_TAB_COMMAND, keyEvent("Tab", { shiftKey: true }));
    });

    await waitFor(() => expect(harness.root.querySelector("ul ul")).toBeNull());
    expect(harness.root.querySelector("p")?.textContent).toBe("parent");
    expect(harness.root.querySelector("ul li")?.textContent).toBe("child");
  });

  it("still un-nests nested items through Lexical's own outdent on Shift+Tab", async () => {
    const harness = renderEditor();
    await harness.ready();
    act(() => resetEditor(harness.editor));
    act(() => { fireEvent(harness.root, pasteEvent("- one\n- two")); });
    await waitFor(() => expect(harness.root.querySelectorAll("li")).toHaveLength(2));
    act(() => {
      selectEndOfText(harness.editor, "two");
      harness.editor.dispatchCommand(KEY_TAB_COMMAND, keyEvent("Tab"));
    });
    await waitFor(() => expect(harness.root.querySelector("ul ul")).toBeTruthy());

    act(() => {
      selectEndOfText(harness.editor, "two");
      harness.editor.dispatchCommand(KEY_TAB_COMMAND, keyEvent("Tab", { shiftKey: true }));
    });

    await waitFor(() => expect(harness.root.querySelector("ul ul")).toBeNull());
    expect(harness.root.querySelectorAll("ul li")).toHaveLength(2);
  });

  it("exits the list on Shift+Enter from an empty item", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ onChange });
    await harness.ready();
    act(() => resetEditor(harness.editor));
    await typeCharacters(harness.editor, "1. ");
    await waitFor(() => expect(harness.root.querySelector("ol li")).toBeTruthy());

    act(() => {
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter", { shiftKey: true }));
    });

    await waitFor(() => expect(harness.root.querySelector("ol")).toBeNull());
    act(() => insertText(harness.editor, "plain"));
    await waitFor(() => expect(lastMarkdown(onChange)).toBe("plain"));
    expect(harness.root.querySelector("ol, ul")).toBeNull();
  });

  it("moves the caret below the list when Shift+Enter lands on an empty trailing line", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ onChange });
    await harness.ready();
    act(() => resetEditor(harness.editor));
    await typeCharacters(harness.editor, "1. one");
    act(() => {
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter", { shiftKey: true }));
    });
    await waitFor(() => expect(harness.root.querySelector("ol li br")).toBeTruthy());

    act(() => {
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter", { shiftKey: true }));
    });

    await waitFor(() => expect(harness.root.querySelector("ol li br")).toBeNull());
    expect(harness.root.querySelector("ol li")?.textContent).toBe("one");
    act(() => insertText(harness.editor, "out"));
    await waitFor(() => expect(lastMarkdown(onChange)).toBe("1. one\n\nout"));
    expect(harness.root.querySelectorAll("ol li")).toHaveLength(1);
  });

  it("un-nests one level on Shift+Enter from an empty nested item", async () => {
    const harness = renderEditor();
    await harness.ready();
    act(() => resetEditor(harness.editor));
    act(() => { fireEvent(harness.root, pasteEvent("- one\n- two")); });
    await waitFor(() => expect(harness.root.querySelectorAll("li")).toHaveLength(2));
    act(() => {
      selectEndOfText(harness.editor, "two");
      harness.editor.dispatchCommand(KEY_TAB_COMMAND, keyEvent("Tab"));
    });
    await waitFor(() => expect(harness.root.querySelector("ul ul")).toBeTruthy());

    act(() => {
      emptyItemContaining(harness.editor, "two");
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter", { shiftKey: true }));
    });
    await waitFor(() => expect(harness.root.querySelector("ul ul")).toBeNull());
    expect(harness.root.querySelectorAll("ul li")).toHaveLength(2);

    act(() => {
      selectEmptyItem(harness.editor);
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter", { shiftKey: true }));
    });
    await waitFor(() => expect(harness.root.querySelectorAll("ul li")).toHaveLength(1));
    expect(harness.root.querySelector("ul li")?.textContent).toBe("one");
  });

  it("keeps inserting a plain newline on Shift+Enter mid-item", async () => {
    const onSubmit = vi.fn();
    const harness = renderEditor({ onSubmit });
    await harness.ready();
    act(() => resetEditor(harness.editor));
    await typeCharacters(harness.editor, "1. one");

    act(() => {
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter", { shiftKey: true }));
    });

    await waitFor(() => expect(harness.root.querySelector("ol li br")).toBeTruthy());
    expect(harness.root.querySelectorAll("ol li")).toHaveLength(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

function renderEditor(overrides: Partial<ComposerRichTextEditorProps> = {}) {
  let editor: LexicalEditor | null = null;
  const props: ComposerRichTextEditorProps = {
    value: "",
    onChange: vi.fn(),
    canSubmit: true,
    onSubmit: vi.fn(),
    placeholder: "Message",
    disabled: false,
    editorRef: (next) => { editor = next; },
    ...overrides,
  };
  const rendered = render(<ComposerRichTextEditor {...props} />);
  const root = rendered.container.querySelector<HTMLElement>("[data-chat-composer-editor]")!;
  return {
    get editor() { return editor!; },
    root,
    ready: () => waitFor(() => expect(editor).toBeTruthy()),
  };
}

function lastMarkdown(onChange: ReturnType<typeof vi.fn>): string | undefined {
  return onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as string | undefined;
}

function resetEditor(editor: LexicalEditor) {
  editor.update(() => {
    const paragraph = $createParagraphNode();
    $getRoot().clear().append(paragraph);
    paragraph.selectEnd();
  }, { discrete: true });
}

function insertText(editor: LexicalEditor, text: string) {
  editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) selection.insertText(text);
  }, { discrete: true });
}

async function typeCharacters(editor: LexicalEditor, text: string) {
  for (const character of text) {
    act(() => insertText(editor, character));
    await Promise.resolve();
  }
}

function selectEndOfText(editor: LexicalEditor, content: string) {
  editor.getRootElement()?.focus();
  editor.update(() => {
    const text = $getRoot().getAllTextNodes().find((node) => node.getTextContent() === content);
    if (!text) throw new Error(`no text node with content "${content}"`);
    text.select(content.length, content.length);
  }, { discrete: true });
}

function selectEmptyItem(editor: LexicalEditor) {
  editor.getRootElement()?.focus();
  editor.update(() => {
    const empty = collectListItems($getRoot()).find((item) => item.getChildrenSize() === 0);
    if (!empty) throw new Error("no empty list item to select");
    empty.select();
  }, { discrete: true });
}

function collectListItems(node: LexicalNode): ListItemNode[] {
  const items: ListItemNode[] = [];
  if ($isListItemNode(node)) items.push(node);
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) items.push(...collectListItems(child));
  }
  return items;
}

function emptyItemContaining(editor: LexicalEditor, content: string) {
  editor.getRootElement()?.focus();
  editor.update(() => {
    const text = $getRoot().getAllTextNodes().find((node) => node.getTextContent() === content);
    if (!text) throw new Error(`no text node with content "${content}"`);
    const item = text.getParentOrThrow();
    text.remove();
    item.select();
  }, { discrete: true });
}

function keyEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, bubbles: true, ...init });
}

function pasteEvent(text: string): ClipboardEvent {
  const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => type === "text/plain" ? text : "" },
  });
  return event;
}
