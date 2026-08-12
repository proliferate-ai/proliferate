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
  PASTE_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  ComposerRichTextEditor,
  type ComposerRichTextEditorProps,
} from "#product/components/workspace/chat/input/ComposerRichTextEditor";
import { getComposerEditorContext } from "#product/components/workspace/chat/input/ComposerEditorDocument";

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

describe("ComposerFencedCodePlugin", () => {
  it("promotes a typed code fence only after its matching close fence", async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const harness = renderEditor({ value: "", onChange, onSubmit });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    onChange.mockClear();

    fireEvent.keyDown(harness.root, { key: "b", ctrlKey: true });
    await typeCharacters(harness.editor, "intro", harness.root);
    fireEvent.keyDown(harness.root, { key: "b", ctrlKey: true });
    insertSoftLineBreak(harness.editor);
    await typeCharacters(harness.editor, "``` ", harness.root);
    expect(harness.root.querySelector('code[spellcheck="false"]')).toBeNull();
    insertSoftLineBreak(harness.editor);
    await typeCharacters(harness.editor, "const ready = true;", harness.root);
    insertSoftLineBreak(harness.editor);
    await typeCharacters(harness.editor, "``", harness.root);
    expect(harness.root.querySelector('code[spellcheck="false"]')).toBeNull();

    await typeCharacters(harness.editor, "`", harness.root);
    const codeBlock = await waitFor(() => {
      const code = harness.root.querySelector<HTMLElement>('code[spellcheck="false"]');
      expect(code).toBeTruthy();
      return code!;
    });

    expect(codeBlock.textContent).toBe("const ready = true;");
    expect(harness.root.textContent).toContain("intro");
    expect(harness.root.querySelector(".font-semibold")?.textContent).toBe("intro");
    expect(codeBlock.className).toContain("font-mono");
    expect(getComposerEditorContext(harness.editor).selectionInCodeBlock).toBe(false);
    expect(harness.editor.getEditorState().read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection) && selection.focus.getNode().isAttached();
    })).toBe(true);
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(
      "**intro**\n\n```\nconst ready = true;\n```\n",
    );
    expect(onSubmit).not.toHaveBeenCalled();

    await typeCharacters(harness.editor, "after", harness.root);
    expect(harness.root.querySelector("p:last-child")?.textContent).toBe("after");
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(
      "**intro**\n\n```\nconst ready = true;\n```\n\nafter",
    );

    act(() => {
      harness.editor.update(() => {
        $getRoot().getChildren().find((node) => node.getType() === "code")?.selectEnd();
      }, { discrete: true });
    });
    expect(getComposerEditorContext(harness.editor).selectionInCodeBlock).toBe(true);
    insertSoftLineBreak(harness.editor);
    await waitFor(() => expect(codeBlock.querySelector("br")).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();

    act(() => {
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter"));
      harness.editor.dispatchCommand(
        KEY_ENTER_COMMAND,
        keyEvent("Enter", { ctrlKey: true }),
      );
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("restores only fully closed fenced Markdown as a code block", async () => {
    const closed = renderEditor({ value: "```c++\nconst ready = true;\n```" });
    await closed.ready();
    expect(closed.root.querySelector('code[data-language="c++"]')?.textContent).toBe(
      "const ready = true;",
    );

    cleanup();
    const unclosed = renderEditor({ value: "```\nconst ready = true;" });
    await unclosed.ready();
    expect(unclosed.root.querySelector('code[spellcheck="false"]')).toBeNull();
    expect(unclosed.root.textContent).toContain("```");
    expect(unclosed.root.textContent).toContain("const ready = true;");
  });

  it("promotes a restored incomplete fence after a blank line is closed", async () => {
    const harness = renderEditor({ value: "```\nfirst\n\nsecond" });
    await harness.ready();
    expect(harness.root.querySelector("code")).toBeNull();
    act(() => {
      harness.editor.update(() => { $getRoot().selectEnd(); }, { discrete: true });
    });

    insertSoftLineBreak(harness.editor);
    await typeCharacters(harness.editor, "```", harness.root);

    const codeBlock = await waitFor(() => {
      const next = harness.root.querySelector<HTMLElement>("code");
      expect(next).toBeTruthy();
      return next!;
    });
    expect(codeBlock.textContent).toBe("first\n\nsecond");
  });

  it("imports a complete pasted code fence as an editable Markdown block", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ value: "", onChange });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    onChange.mockClear();
    const markdown = "```ts\nconst ready = true;\n```";
    const event = pasteEvent(markdown);

    act(() => { fireEvent(harness.root, event); });

    const codeBlock = await waitFor(() => {
      const code = harness.root.querySelector<HTMLElement>('code[data-language="ts"]');
      expect(code).toBeTruthy();
      return code!;
    });
    expect(event.defaultPrevented).toBe(true);
    expect(codeBlock.textContent).toBe("const ready = true;");
    expect(getComposerEditorContext(harness.editor).selectionInCodeBlock).toBe(false);
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`${markdown}\n`);
  });

  it("keeps an incomplete pasted fence completable after blank lines", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ value: "", onChange });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    onChange.mockClear();
    const markdown = "```ts\nfirst\n\nsecond";
    const event = pasteEvent(markdown);

    act(() => { fireEvent(harness.root, event); });

    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toBe(
      "\\`\\`\\`ts\nfirst\n\nsecond",
    ));
    expect(event.defaultPrevented).toBe(true);
    expect(harness.root.querySelector("code")).toBeNull();
    expect(harness.root.querySelectorAll("p")).toHaveLength(1);
    expect(getComposerEditorContext(harness.editor).selectionInCodeBlock).toBe(true);

    insertSoftLineBreak(harness.editor);
    await typeCharacters(harness.editor, "```", harness.root);

    const codeBlock = await waitFor(() => {
      const code = harness.root.querySelector<HTMLElement>('code[data-language="ts"]');
      expect(code).toBeTruthy();
      return code!;
    });
    expect(codeBlock.textContent).toBe("first\n\nsecond");
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`${markdown}\n\`\`\`\n`);
  });

  it("keeps formatted paste literal while an opening fence is incomplete", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ value: "", onChange });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    onChange.mockClear();
    await typeCharacters(harness.editor, "```", harness.root);
    insertSoftLineBreak(harness.editor);
    expect(getComposerEditorContext(harness.editor).selectionInCodeBlock).toBe(true);
    await typeCharacters(
      harness.editor,
      "**literal** [file](src/file.ts) ",
      harness.root,
    );
    expect(harness.root.querySelector(".font-semibold")).toBeNull();
    expect(harness.root.querySelector("[data-composer-file-mention]")).toBeNull();
    const filePaste = pasteEvent("", [
      new File(["image"], "screenshot.png", { type: "image/png" }),
    ]);
    act(() => { fireEvent(harness.root, filePaste); });
    expect(filePaste.defaultPrevented).toBe(false);
    insertSoftLineBreak(harness.editor);
    const plainPaste = pasteEvent("const plain = true;");
    act(() => { fireEvent(harness.root, plainPaste); });
    await waitFor(() => expect(harness.root.textContent).toContain("const plain = true;"));
    expect(plainPaste.defaultPrevented).toBe(true);
    insertSoftLineBreak(harness.editor);
    const pastedCode = "- item\n[Docs](https://example.com)\nhttps://example.com";
    const event = pasteEvent(pastedCode);

    act(() => { fireEvent(harness.root, event); });

    expect(event.defaultPrevented).toBe(true);
    expect(harness.root.querySelector("ul")).toBeNull();
    expect(harness.root.querySelector("a")).toBeNull();
    await waitFor(() => {
      expect(harness.root.textContent).toContain("[Docs](https://example.com)");
    });

    insertSoftLineBreak(harness.editor);
    await typeCharacters(harness.editor, "```", harness.root);
    const codeBlock = await waitFor(() => {
      const next = harness.root.querySelector<HTMLElement>("code");
      expect(next).toBeTruthy();
      return next!;
    });
    const code = [
      "**literal** [file](src/file.ts) ",
      "const plain = true;",
      pastedCode,
    ].join("\n");
    expect(codeBlock.textContent).toBe(code);
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`\`\`\`\n${code}\n\`\`\`\n`);
  });

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

  it("imports a pasted rendered code block as one escapable block", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ value: "", onChange });
    await harness.ready();
    act(() => resetText(harness.editor, ""));
    onChange.mockClear();

    act(() => {
      harness.editor.dispatchCommand(
        PASTE_COMMAND,
        htmlPasteEvent(
          "<pre><code>const x = 1;\nconst y = 2;</code></pre>",
          "const x = 1;\nconst y = 2;",
        ),
      );
    });

    const codeBlock = await waitFor(() => {
      const code = harness.root.querySelector<HTMLElement>('code[spellcheck="false"]');
      expect(code).toBeTruthy();
      return code!;
    });
    // One block, not Lexical's nested <pre><code> double conversion.
    expect(harness.root.querySelectorAll("code")).toHaveLength(1);
    expect(codeBlock.textContent).toBe("const x = 1;const y = 2;");
    // The trailing continuation paragraph is the escape hatch below the block.
    await waitFor(() => {
      expect(harness.editor.getEditorState().read(() =>
        $getRoot().getLastChild()?.getType(),
      )).toBe("paragraph");
    });
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(
      "```\nconst x = 1;\nconst y = 2;\n```\n",
    );
  });

  it("keeps formatted Markdown paste literal inside a code block", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({
      value: "```\nconst docs = \"\";\n```",
      onChange,
    });
    await harness.ready();
    act(() => {
      harness.editor.update(() => {
        $getRoot().getFirstChild()?.selectEnd();
      }, { discrete: true });
    });
    onChange.mockClear();
    const markdownLink = "[Docs](https://example.com)";

    act(() => { fireEvent(harness.root, pasteEvent(markdownLink)); });

    await waitFor(() => {
      expect(harness.root.querySelector("code")?.textContent).toContain(markdownLink);
    });
    expect(harness.root.querySelector("code a")).toBeNull();
    expect(onChange.mock.calls.at(-1)?.[0]).toContain(markdownLink);
  });
});

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
  const { container } = render(<ComposerRichTextEditor {...props} />);
  return {
    get editor() { return editor!; },
    root: container.querySelector<HTMLElement>("[data-chat-composer-editor]")!,
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
  root?: HTMLElement,
) {
  for (const character of text) {
    if (root) {
      fireEvent(root, new InputEvent("beforeinput", {
        bubbles: true,
        data: character,
        inputType: "insertText",
      }));
    }
    act(() => insertText(editor, character));
    await Promise.resolve();
  }
}

function insertSoftLineBreak(editor: LexicalEditor) {
  act(() => {
    editor.dispatchCommand(
      KEY_ENTER_COMMAND,
      keyEvent("Enter", { shiftKey: true }),
    );
  });
}

function keyEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, bubbles: true, ...init });
}

function pasteEvent(text: string, files: File[] = []): ClipboardEvent {
  const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files,
      getData: (type: string) => type === "text/plain" ? text : "",
      types: files.length > 0 ? ["Files"] : ["text/plain"],
    },
  });
  return event;
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
