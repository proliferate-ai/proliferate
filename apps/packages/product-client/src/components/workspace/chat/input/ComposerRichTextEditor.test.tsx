// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  PASTE_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  ComposerRichTextEditor,
  replaceComposerTextRange,
  type ComposerRichTextEditorProps,
} from "#product/components/workspace/chat/input/ComposerRichTextEditor";
import type { ChatComposerEditorSnapshot } from "#product/lib/domain/chat/composer/file-mention-draft-model";

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal("DragEvent", class DragEvent extends Event {});
});

describe("ComposerRichTextEditor", () => {
  it("toggles bold and italic for future typing from command-key shortcuts", async () => {
    const harness = renderEditor();
    await harness.ready();

    act(() => resetText(harness.editor, ""));
    fireEvent.keyDown(harness.root, { key: "b", ctrlKey: true });
    act(() => insertText(harness.editor, "bold"));
    fireEvent.keyDown(harness.root, { key: "b", ctrlKey: true });
    fireEvent.keyDown(harness.root, { key: "i", ctrlKey: true });
    act(() => insertText(harness.editor, "italic"));

    await waitFor(() => {
      expect(harness.root.querySelector(".font-semibold")?.textContent).toBe("bold");
      expect(harness.root.querySelector(".italic")?.textContent).toBe("italic");
    });
  });

  it("applies emphasis and list Markdown shortcuts", async () => {
    const harness = renderEditor();
    await harness.ready();

    act(() => resetText(harness.editor, ""));
    await typeCharacters(harness.editor, "*hello* ");
    expect(harness.root.querySelector(".italic")?.textContent).toBe("hello");

    act(() => resetText(harness.editor, ""));
    await typeCharacters(harness.editor, "- ");
    expect(harness.root.querySelector("ul li")).toBeTruthy();
  });

  it("keeps list Enter and indentation Lexical-owned", async () => {
    const onSubmit = vi.fn();
    const harness = renderEditor({ submitBehavior: "workspace", onSubmit });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    await typeCharacters(harness.editor, "- one");

    act(() => {
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter"));
      insertText(harness.editor, "two");
      harness.editor.dispatchCommand(KEY_TAB_COMMAND, keyEvent("Tab"));
    });
    await waitFor(() => expect(harness.root.querySelectorAll("li")).toHaveLength(2));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(harness.root.querySelector("ul ul")).toBeTruthy();

    act(() => {
      harness.editor.dispatchCommand(KEY_TAB_COMMAND, keyEvent("Tab", { shiftKey: true }));
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter"));
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter"));
    });
    await waitFor(() => expect(harness.root.querySelector("ul + p")).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("creates bare and selected HTTPS links while typed Markdown stays literal", async () => {
    const bare = renderEditor();
    await bare.ready();
    act(() => resetText(bare.editor, ""));
    act(() => { bare.editor.dispatchCommand(PASTE_COMMAND, pasteEvent("https://example.com")); });
    await waitFor(() => expect(bare.root.querySelector('a[href="https://example.com"]')).toBeTruthy());

    cleanup();
    const selected = renderEditor({ value: "Docs" });
    await selected.ready();
    act(() => {
      selected.editor.update(() => {
        const text = $getRoot().getAllTextNodes()[0]!;
        text.select(0, 4);
      }, { discrete: true });
      selected.editor.dispatchCommand(PASTE_COMMAND, pasteEvent("https://example.com/docs"));
    });
    await waitFor(() => expect(selected.root.querySelector("a")?.textContent).toBe("Docs"));

    cleanup();
    const typed = renderEditor({ value: "[Docs](https://example.com)" });
    await typed.ready();
    expect(typed.root.querySelector("a")).toBeNull();
    expect(typed.root.textContent).toContain("[Docs](https://example.com)");
  });

  it("restores pasted-link identity from the controlled snapshot", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ onChange });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    onChange.mockClear();
    act(() => { harness.editor.dispatchCommand(PASTE_COMMAND, pasteEvent("https://example.com")); });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [markdown, , snapshot] = onChange.mock.calls[onChange.mock.calls.length - 1]! as [string, number | undefined, ChatComposerEditorSnapshot];

    harness.rerender({ value: "", snapshot: undefined });
    await waitFor(() => expect(harness.root.querySelector("a")).toBeNull());
    harness.rerender({ value: markdown, snapshot });
    await waitFor(() => expect(harness.root.querySelector('a[href="https://example.com"]')).toBeTruthy());
  });

  it("replaces only the selected slash range and preserves surrounding rich text", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ value: "/rev **tail**", onChange });
    await harness.ready();
    onChange.mockClear();

    act(() => replaceComposerTextRange(harness.editor, 0, 5, "/review "));

    await waitFor(() => expect(harness.root.textContent).toBe("/review tail"));
    expect(harness.root.querySelector(".font-semibold")?.textContent).toBe("tail");
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]).toBe("/review **tail**");
  });

  it("forwards the originating native event timestamp to the document change", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ onChange });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    onChange.mockClear();
    const beforeInput = new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: "x" });
    Object.defineProperty(beforeInput, "timeStamp", { value: 1234 });
    fireEvent(harness.root, beforeInput);
    act(() => insertText(harness.editor, "x"));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(
      "x",
      1234,
      expect.objectContaining({ version: 1 }),
    ));
  });

  it("gives each surface exactly one submit owner", async () => {
    const workspaceSubmit = vi.fn();
    const workspace = renderEditor({ submitBehavior: "workspace", onSubmit: workspaceSubmit });
    await workspace.ready();
    act(() => { workspace.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter")); });
    expect(workspaceSubmit).toHaveBeenCalledTimes(1);

    cleanup();
    const homeSubmit = vi.fn();
    const home = renderEditor({ submitBehavior: "home", onSubmit: homeSubmit });
    await home.ready();
    act(() => { home.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter")); });
    expect(homeSubmit).not.toHaveBeenCalled();
    act(() => {
      home.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter", { metaKey: true }));
    });
    expect(homeSubmit).toHaveBeenCalledTimes(1);
  });
});

function renderEditor(overrides: Partial<ComposerRichTextEditorProps> = {}) {
  let editor: LexicalEditor | null = null;
  const defaults: ComposerRichTextEditorProps = {
    value: "seed",
    onChange: vi.fn(),
    submitBehavior: "workspace",
    canSubmit: true,
    onSubmit: vi.fn(),
    placeholder: "Message",
    disabled: false,
    editorRef: (next) => { editor = next; },
  };
  let props = { ...defaults, ...overrides };
  const rendered = render(<ComposerRichTextEditor {...props} />);
  const root = rendered.container.querySelector<HTMLElement>("[data-chat-composer-editor]")!;
  return {
    get editor() { return editor!; },
    root,
    ready: () => waitFor(() => expect(editor).toBeTruthy()),
    rerender(next: Partial<ComposerRichTextEditorProps>) {
      props = { ...props, ...next };
      rendered.rerender(<ComposerRichTextEditor {...props} />);
    },
  };
}

function resetText(editor: LexicalEditor, text: string) {
  editor.update(() => {
    const paragraph = $createParagraphNode();
    if (text) paragraph.append($createTextNode(text));
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

function keyEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, bubbles: true, ...init });
}

function pasteEvent(text: string): ClipboardEvent {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => type === "text/plain" ? text : "" },
  });
  return event;
}
