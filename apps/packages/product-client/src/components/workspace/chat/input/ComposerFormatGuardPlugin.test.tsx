// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $setSelection,
  PASTE_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  ComposerRichTextEditor,
  type ComposerRichTextEditorProps,
} from "#product/components/workspace/chat/input/ComposerRichTextEditor";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import { shouldDispatchKeyboardShortcut } from "#product/lib/domain/shortcuts/dispatch-policy";

let originalRangeRectDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  originalRangeRectDescriptor = Object.getOwnPropertyDescriptor(
    Range.prototype,
    "getBoundingClientRect",
  );
  vi.stubGlobal("DragEvent", class DragEvent extends Event {});
  vi.stubGlobal("ClipboardEvent", class ClipboardEvent extends Event {});
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
});

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

describe("ComposerFormatGuardPlugin", () => {
  it("keeps pasted inline-code characters but strips the code text format", async () => {
    mockRangeRect();
    const onChange = vi.fn();
    const harness = renderEditor({ value: "", onChange });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    onChange.mockClear();

    // A copied rendered code span arrives as text/html <code>; Lexical maps a
    // single-line <code> to the inline-code text format rather than a block.
    act(() => {
      harness.editor.dispatchCommand(
        PASTE_COMMAND,
        htmlPasteEvent("<code>const ready = true;</code>", "const ready = true;"),
      );
    });

    await waitFor(() => {
      expect(harness.root.textContent).toBe("const ready = true;");
    });
    expect(harness.root.querySelector("code")).toBeNull();
    act(() => {
      harness.editor.update(() => {
        $getRoot().getAllTextNodes().at(-1)?.selectEnd();
      }, { discrete: true });
    });
    await typeCharacters(harness.editor, " and typed", harness.root);
    expect(harness.root.querySelector("code")).toBeNull();
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("const ready = true; and typed");
  });

  it("drops pasted alignment but keeps bold and italic", async () => {
    mockRangeRect();
    const onChange = vi.fn();
    const harness = renderEditor({ value: "", onChange });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    onChange.mockClear();

    act(() => {
      harness.editor.dispatchCommand(
        PASTE_COMMAND,
        htmlPasteEvent(
          '<p style="text-align: center;"><b>bold</b> <i>italic</i> <u>under</u> <s>struck</s></p>',
          "bold italic under struck",
        ),
      );
    });

    await waitFor(() => {
      expect(harness.root.textContent).toBe("bold italic under struck");
    });
    expect(harness.root.querySelector(".font-semibold")?.textContent).toBe("bold");
    expect(harness.root.querySelector(".italic")?.textContent).toBe("italic");
    expect(readBlockFormats(harness.editor)).toEqual([{ format: "", indent: 0 }]);
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("**bold** *italic* under struck");
  });

  it("drops pasted alignment on lists without breaking list structure", async () => {
    mockRangeRect();
    const onChange = vi.fn();
    const harness = renderEditor({ value: "", onChange });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    onChange.mockClear();

    act(() => {
      harness.editor.dispatchCommand(
        PASTE_COMMAND,
        htmlPasteEvent(
          '<ul style="text-align: center;">'
          + '<li style="text-align: center;">one</li>'
          + '<li style="text-align: center;">two</li>'
          + "</ul>",
          "one\ntwo",
        ),
      );
    });

    await waitFor(() => {
      expect(harness.root.querySelectorAll("li")).toHaveLength(2);
    });
    for (const block of readBlockFormats(harness.editor)) {
      expect(block.format).toBe("");
    }
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("- one\n- two");
  });

  it("keeps nested list structure while clearing block alignment and indent", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ value: "- parent\n    - child", onChange });
    await harness.ready();

    // Alignment and indent debris on a paragraph clears; the nested list's
    // structural indentation survives the guard.
    act(() => {
      harness.editor.update(() => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("stray"));
        paragraph.setFormat("right");
        paragraph.setIndent(2);
        $getRoot().append(paragraph);
      }, { discrete: true });
    });

    await waitFor(() => {
      expect(harness.editor.getEditorState().read(() => {
        const paragraph = $getRoot().getLastChild();
        return $isParagraphNode(paragraph)
          ? { format: paragraph.getFormatType(), indent: paragraph.getIndent() }
          : null;
      })).toEqual({ format: "", indent: 0 });
    });
    expect(harness.root.querySelector("ul ul li")?.textContent).toBe("child");
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("- parent\n    - child\n\nstray");
  });

  it("does not leak a stripped selection format into later input", async () => {
    mockRangeRect();
    const onChange = vi.fn();
    const harness = renderEditor({ value: "", onChange });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    onChange.mockClear();

    act(() => {
      harness.editor.dispatchCommand(
        PASTE_COMMAND,
        htmlPasteEvent("<u>under</u>", "under"),
      );
    });
    await waitFor(() => expect(harness.root.textContent).toBe("under"));

    act(() => {
      harness.editor.update(() => {
        $getRoot().getAllTextNodes().at(-1)?.selectEnd();
      }, { discrete: true });
    });
    await typeCharacters(harness.editor, " typed", harness.root);
    expect(harness.editor.getEditorState().read(() => (
      $getRoot().getAllTextNodes().every((textNode) => textNode.getFormat() === 0)
    ))).toBe(true);
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("under typed");
  });
});

describe("composer bold-chord ownership", () => {
  it("cedes the sidebar's B chord to bold only while text is highlighted", async () => {
    const harness = renderEditor({ value: "" });
    await harness.ready();
    act(() => resetText(harness.editor, "chord"));
    const boldChordEvent = {
      key: "b",
      code: "KeyB",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      target: harness.root,
    } as unknown as KeyboardEvent;

    // Collapsed caret: the editor does not claim the chord.
    expect(harness.root.hasAttribute("data-chat-composer-highlight")).toBe(false);
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.toggleLeftSidebar, boldChordEvent))
      .toBe(true);

    act(() => {
      harness.editor.update(() => {
        const textNode = $getRoot().getAllTextNodes()[0]!;
        const selection = $createRangeSelection();
        selection.setTextNodeRange(textNode, 0, textNode, textNode.getTextContentSize());
        $setSelection(selection);
      }, { discrete: true });
    });

    // Highlighted text: the editor claims the chord and the key bolds it.
    await waitFor(() => {
      expect(harness.root.hasAttribute("data-chat-composer-highlight")).toBe(true);
    });
    expect(shouldDispatchKeyboardShortcut(SHORTCUTS.toggleLeftSidebar, boldChordEvent))
      .toBe(false);
    fireEvent.keyDown(harness.root, { key: "b", ctrlKey: true });
    await waitFor(() => {
      expect(harness.root.querySelector(".font-semibold")?.textContent).toBe("chord");
    });
  });
});

function readBlockFormats(editor: LexicalEditor) {
  return editor.getEditorState().read(() => {
    const blocks: Array<{ format: string; indent: number }> = [];
    const visit = (node: ReturnType<typeof $getRoot>) => {
      for (const child of node.getChildren()) {
        if (!$isElementNode(child) || child.isInline()) continue;
        blocks.push({ format: child.getFormatType(), indent: child.getIndent() });
        visit(child as ReturnType<typeof $getRoot>);
      }
    };
    visit($getRoot());
    return blocks;
  });
}

function renderEditor(overrides: Partial<ComposerRichTextEditorProps> = {}) {
  let editor: LexicalEditor | null = null;
  const props: ComposerRichTextEditorProps = {
    value: "seed",
    onChange: vi.fn(),
    canSubmit: true,
    onSubmit: vi.fn(),
    placeholder: "Message",
    disabled: false,
    editorRef: (next) => { editor = next; },
    ...overrides,
  };
  const rendered = render(<ComposerRichTextEditor {...props} />);
  return {
    get editor() { return editor!; },
    root: rendered.container.querySelector<HTMLElement>("[data-chat-composer-editor]")!,
    ready: () => waitFor(() => expect(editor).toBeTruthy()),
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

async function typeCharacters(
  editor: LexicalEditor,
  text: string,
  root: HTMLElement,
) {
  for (const character of text) {
    fireEvent(root, new InputEvent("beforeinput", {
      bubbles: true,
      data: character,
      inputType: "insertText",
    }));
    act(() => insertText(editor, character));
    await Promise.resolve();
  }
}

// jsdom has no Range.getBoundingClientRect; Lexical's scroll-into-view path
// needs one once the editor root has taken focus (a paste commit restores it).
function mockRangeRect() {
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      toJSON: () => ({}),
      top: 0,
      width: 0,
      x: 0,
      y: 0,
    }),
  });
}

function htmlPasteEvent(html: string, plain: string): ClipboardEvent {
  const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      getData: (type: string) =>
        type === "text/html" ? html : type === "text/plain" ? plain : "",
      types: ["text/html", "text/plain"],
    },
  });
  return event;
}
