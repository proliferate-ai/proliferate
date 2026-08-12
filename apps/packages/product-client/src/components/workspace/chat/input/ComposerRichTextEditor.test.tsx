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
  type ComposerRichTextEditorProps,
} from "#product/components/workspace/chat/input/ComposerRichTextEditor";
import { replaceComposerTextRange } from "#product/components/workspace/chat/input/ComposerEditorDocument";
import type { ChatComposerEditorSnapshot } from "#product/lib/domain/chat/composer/file-mention-draft-model";

let originalRangeRectDescriptor: PropertyDescriptor | undefined;

afterEach(() => {
  cleanup();
  if (originalRangeRectDescriptor === undefined) {
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  } else {
    Object.defineProperty(
      Range.prototype,
      "getBoundingClientRect",
      originalRangeRectDescriptor,
    );
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  originalRangeRectDescriptor = Object.getOwnPropertyDescriptor(
    Range.prototype,
    "getBoundingClientRect",
  );
  vi.stubGlobal("DragEvent", class DragEvent extends Event {});
  vi.stubGlobal("ClipboardEvent", class ClipboardEvent extends Event {});
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
});

describe("ComposerRichTextEditor", () => {
  it("anchors the placeholder to the editor's local positioning frame", async () => {
    const harness = renderEditor({ value: "" });
    await harness.ready();

    const frame = harness.root.closest<HTMLElement>("[data-chat-composer-editor-frame]");
    expect(frame).toBeTruthy();
    expect(frame?.classList.contains("relative")).toBe(true);
    expect(frame?.textContent).toBe("Message");
  });

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

  it("submits numbered-list drafts on Enter and inserts a newline on Shift-Enter", async () => {
    const onSubmit = vi.fn();
    const harness = renderEditor({ onSubmit });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    await typeCharacters(harness.editor, "1. one");

    expect(harness.root.querySelectorAll("ol li")).toHaveLength(1);
    act(() => {
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter", { shiftKey: true }));
    });
    await waitFor(() => expect(harness.root.querySelector("ol li br")).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();

    const enter = keyEvent("Enter", { cancelable: true });
    act(() => {
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, enter);
    });
    expect(enter.defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(harness.root.querySelectorAll("ol li")).toHaveLength(1);
  });

  it("keeps list indentation Lexical-owned", async () => {
    const harness = renderEditor();
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    act(() => { fireEvent(harness.root, pasteEvent("- one\n- two")); });
    await waitFor(() => expect(harness.root.querySelectorAll("li")).toHaveLength(2));

    act(() => {
      harness.editor.dispatchCommand(KEY_TAB_COMMAND, keyEvent("Tab"));
    });
    await waitFor(() => expect(harness.root.querySelector("ul ul")).toBeTruthy());

    act(() => {
      harness.editor.dispatchCommand(KEY_TAB_COMMAND, keyEvent("Tab", { shiftKey: true }));
    });
    await waitFor(() => expect(harness.root.querySelector("ul ul")).toBeNull());
  });

  it("creates bare and selected HTTPS links", async () => {
    const bare = renderEditor();
    await bare.ready();
    act(() => resetText(bare.editor, ""));
    act(() => { bare.editor.dispatchCommand(PASTE_COMMAND, pasteEvent("https://example.com")); });
    await waitFor(() => expect(bare.root.querySelector('a[href="https://example.com"]')).toBeTruthy());
    const bareLink = bare.root.querySelector('a[href="https://example.com"]');
    expect(bareLink?.className).toContain("no-underline");
    expect(bareLink?.className).toContain("hover:underline");
    expect(bareLink?.className).toContain("focus-visible:underline");

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

  });

  it("formats complete Markdown HTTPS links only when pasted", async () => {
    const onChange = vi.fn();
    const pasted = renderEditor({ onChange });
    await pasted.ready();
    act(() => resetText(pasted.editor, ""));
    onChange.mockClear();

    const completePaste = pasteEvent("Read [Docs](https://example.com/docs) or [Help](https://example.com/help). ");
    act(() => { pasted.editor.dispatchCommand(PASTE_COMMAND, completePaste); });

    await waitFor(() => expect(pasted.root.querySelectorAll("a")).toHaveLength(2));
    expect(completePaste.defaultPrevented).toBe(true);
    expect(pasted.root.textContent).toBe("Read Docs or Help. ");
    expect(pasted.root.querySelector('a[href="https://example.com/docs"]')?.textContent).toBe("Docs");
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]).toBe(
      "Read [Docs](https://example.com/docs) or [Help](https://example.com/help). ",
    );

    cleanup();
    const typed = renderEditor();
    await typed.ready();
    act(() => resetText(typed.editor, ""));
    await typeCharacters(typed.editor, "[Docs](https://example.com)");
    expect(typed.root.querySelector("a")).toBeNull();
    expect(typed.root.textContent).toBe("[Docs](https://example.com)");
  });

  it("serializes a file mention chip back to its markdown link unchanged", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ value: "", onChange });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    onChange.mockClear();

    // Typing the markdown form is what promotes it to a chip, so this round-trips
    // the chip's glyph/path decoration back through markdown export.
    await typeCharacters(harness.editor, "See [setup.md](docs/guides/setup.md)");

    const chip = await waitFor(() => {
      const next = harness.root.querySelector<HTMLElement>("[data-composer-file-mention]");
      expect(next).toBeTruthy();
      return next!;
    });
    expect(chip.querySelector("[data-composer-file-mention-glyph] svg")).toBeTruthy();
    expect(
      chip
        .querySelector("[data-composer-file-mention-content]")
        ?.getAttribute("data-composer-file-mention-directory"),
    ).toBe("docs/guides");
    // Neither the glyph nor the painted directory reaches the text stream.
    expect(harness.root.textContent).toBe("See setup.md");
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]).toBe(
      "See [setup.md](docs/guides/setup.md)",
    );
  });

  it("formats complete pasted Markdown lists as editable list blocks", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ onChange });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    onChange.mockClear();

    const listPaste = pasteEvent("- **first**\n- second");
    act(() => { fireEvent(harness.root, listPaste); });

    await waitFor(() => expect(harness.root.querySelectorAll("ul li")).toHaveLength(2));
    expect(listPaste.defaultPrevented).toBe(true);
    expect(harness.root.querySelector("ul li .font-semibold")?.textContent).toBe("first");
    expect(harness.root.querySelectorAll("ul li")[1]?.textContent).toBe("second");
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]).toBe(
      "- **first**\n- second",
    );
  });

  it("resets inherited text formats when an external value replaces the draft", async () => {
    mockRangeRect({ height: 15, left: 24, top: 18 });
    const onChange = vi.fn();
    const harness = renderEditor({ value: "seed", onChange });
    await harness.ready();

    // Rich-paste debris can leave format bits on the live selection; they
    // survive a root clear, so without the reset every message typed after a
    // send would inherit the `code` format (PRO-159).
    act(() => {
      harness.editor.update(() => {
        const selection = $getRoot().selectEnd();
        selection.format = 16;
        selection.dirty = true;
      }, { discrete: true });
    });

    onChange.mockClear();
    harness.rerender({ value: "", snapshot: undefined });
    await waitFor(() => expect(harness.root.textContent).toBe(""));

    expect(harness.editor.getEditorState().read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection) ? selection.format : null;
    })).toBe(0);

    act(() => insertText(harness.editor, "plain again"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("plain again");
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

  it("submits on plain or primary-modified Enter and inserts a newline on Shift-Enter", async () => {
    const onSubmit = vi.fn();
    const harness = renderEditor({ onSubmit });
    await harness.ready();
    act(() => resetText(harness.editor, "draft"));
    act(() => { harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter")); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(harness.root.querySelector("br")).toBeNull();
    act(() => {
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter", { shiftKey: true }));
    });
    await waitFor(() => expect(harness.root.querySelector("br")).toBeTruthy());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    act(() => {
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter", { metaKey: true }));
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("does not submit on Enter while sending is refused or composition is active", async () => {
    const onSubmit = vi.fn();
    const refused = renderEditor({ onSubmit, canSubmit: false });
    await refused.ready();
    act(() => resetText(refused.editor, ""));
    act(() => { refused.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter")); });
    expect(onSubmit).not.toHaveBeenCalled();

    cleanup();
    const composingSubmit = vi.fn();
    const composing = renderEditor({ onSubmit: composingSubmit });
    await composing.ready();
    act(() => {
      composing.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter", { isComposing: true }));
    });
    expect(composingSubmit).not.toHaveBeenCalled();
  });

  it("shows an editor-owned one-pixel caret only after valid local geometry", async () => {
    mockRangeRect({ height: 15, left: 24, top: 18 });
    const harness = renderEditor();
    await harness.ready();
    mockComposerBounds(harness.root, harness.frame);
    harness.root.style.setProperty("--color-text-caret", "rgb(1, 2, 3)");

    act(() => {
      harness.root.focus();
      resetText(harness.editor, "caret");
    });

    const caret = await waitFor(() => {
      const nextCaret = harness.frame.querySelector<HTMLElement>(
        "[data-chat-composer-caret]",
      );
      expect(nextCaret?.style.display).toBe("block");
      return nextCaret!;
    });
    expect(caret.parentElement).toBe(harness.frame);
    expect(caret.style.position).toBe("absolute");
    expect(caret.style.zIndex).toBe("");
    expect(caret.style.width).toBe("1px");
    expect(caret.style.height).toBe("15px");
    expect(caret.style.left).toBe("14px");
    expect(caret.style.top).toBe("10px");
    expect(caret.style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(harness.root.style.caretColor).toBe("transparent");

    fireEvent.compositionStart(harness.root);
    expect(caret.style.display).toBe("none");
    expect(harness.root.style.caretColor).toBe("");

    fireEvent.compositionEnd(harness.root);
    act(() => insertText(harness.editor, "!"));
    await waitFor(() => expect(caret.style.display).toBe("block"));

    act(() => {
      harness.editor.update(() => {
        $getRoot().getAllTextNodes()[0]?.select(0, 1);
      }, { discrete: true });
    });
    await waitFor(() => expect(caret.style.display).toBe("none"));
    expect(harness.root.style.caretColor).toBe("");

    act(() => harness.root.blur());
    await waitFor(() => expect(harness.root.style.caretColor).toBe(""));

    act(() => {
      harness.root.focus();
      insertText(harness.editor, "!");
    });
    await waitFor(() => expect(harness.root.style.caretColor).toBe("transparent"));
    harness.unmount();
    expect(harness.root.style.caretColor).toBe("");
    expect(caret.isConnected).toBe(false);
  });

  it("keeps the native caret when replacement geometry is invalid", async () => {
    mockRangeRect({ height: 0, left: 24, top: 18 });
    const harness = renderEditor();
    await harness.ready();
    mockComposerBounds(harness.root, harness.frame);

    act(() => {
      harness.root.focus();
      resetText(harness.editor, "fallback");
    });

    await waitFor(() => expect(harness.root.style.caretColor).toBe(""));
    expect(
      harness.frame.querySelector<HTMLElement>("[data-chat-composer-caret]")
        ?.style.display,
    ).not.toBe("block");
  });

  it("keeps the native caret when the selection rectangle escapes the editor", async () => {
    mockRangeRect({ height: 15, left: 240, top: 18 });
    const harness = renderEditor();
    await harness.ready();
    mockComposerBounds(harness.root, harness.frame);

    act(() => {
      harness.root.focus();
      resetText(harness.editor, "outside");
    });

    await waitFor(() => expect(harness.root.style.caretColor).toBe(""));
    expect(
      harness.frame.querySelector<HTMLElement>("[data-chat-composer-caret]")
        ?.style.display,
    ).not.toBe("block");
  });

  it("restores the native caret whenever the mounted editor becomes hidden or inert", async () => {
    mockRangeRect({ height: 15, left: 24, top: 18 });
    const harness = renderEditor();
    await harness.ready();
    mockComposerBounds(harness.root, harness.frame);

    act(() => {
      harness.root.focus();
      resetText(harness.editor, "visibility");
    });

    const caret = harness.frame.querySelector<HTMLElement>("[data-chat-composer-caret]")!;
    await waitFor(() => expect(caret.style.display).toBe("block"));

    harness.container.setAttribute("aria-hidden", "true");
    await waitFor(() => expect(caret.style.display).toBe("none"));
    expect(harness.root.style.caretColor).toBe("");

    harness.container.removeAttribute("aria-hidden");
    await waitFor(() => expect(caret.style.display).toBe("block"));
    expect(harness.root.style.caretColor).toBe("transparent");

    harness.container.setAttribute("inert", "");
    await waitFor(() => expect(caret.style.display).toBe("none"));
    expect(harness.root.style.caretColor).toBe("");
  });

  it("remeasures local caret geometry when the editor frame resizes", async () => {
    const notifyResize = stubCapturingResizeObserver();
    mockRangeRect({ height: 15, left: 24, top: 18 });
    const harness = renderEditor();
    await harness.ready();
    mockComposerBounds(harness.root, harness.frame);

    act(() => {
      harness.root.focus();
      resetText(harness.editor, "resize");
    });

    const caret = harness.frame.querySelector<HTMLElement>("[data-chat-composer-caret]")!;
    await waitFor(() => expect(caret.style.left).toBe("14px"));

    mockRangeRect({ height: 15, left: 54, top: 18 });
    act(() => notifyResize());
    await waitFor(() => expect(caret.style.left).toBe("44px"));
  });
});

function renderEditor(overrides: Partial<ComposerRichTextEditorProps> = {}) {
  let editor: LexicalEditor | null = null;
  const defaults: ComposerRichTextEditorProps = {
    value: "seed",
    onChange: vi.fn(),
    canSubmit: true,
    onSubmit: vi.fn(),
    placeholder: "Message",
    disabled: false,
    editorRef: (next) => { editor = next; },
  };
  let props = { ...defaults, ...overrides };
  const rendered = render(<ComposerRichTextEditor {...props} />);
  const root = rendered.container.querySelector<HTMLElement>("[data-chat-composer-editor]")!;
  const frame = rendered.container.querySelector<HTMLElement>(
    "[data-chat-composer-editor-frame]",
  )!;
  return {
    container: rendered.container,
    get editor() { return editor!; },
    frame,
    root,
    ready: () => waitFor(() => expect(editor).toBeTruthy()),
    rerender(next: Partial<ComposerRichTextEditorProps>) {
      props = { ...props, ...next };
      rendered.rerender(<ComposerRichTextEditor {...props} />);
    },
    unmount: rendered.unmount,
  };
}

function mockComposerBounds(root: HTMLElement, frame: HTMLElement) {
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(
    domRect({ height: 34, left: 10, top: 8, width: 200 }),
  );
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
    domRect({ height: 30, left: 12, top: 10, width: 180 }),
  );
}

function domRect({
  height,
  left,
  top,
  width,
}: {
  height: number;
  left: number;
  top: number;
  width: number;
}): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  } as DOMRect;
}

function stubCapturingResizeObserver(): () => void {
  const callbacks: ResizeObserverCallback[] = [];
  class CapturingResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }

    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", CapturingResizeObserver);
  return () => {
    for (const callback of callbacks) {
      callback([], {} as ResizeObserver);
    }
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
  const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => type === "text/plain" ? text : "" },
  });
  return event;
}

function mockRangeRect({
  height,
  left,
  top,
}: {
  height: number;
  left: number;
  top: number;
}) {
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: vi.fn(() => ({
      bottom: top + height,
      height,
      left,
      right: left,
      toJSON: () => ({}),
      top,
      width: 0,
      x: left,
      y: top,
    } satisfies DOMRect)),
  });
}
