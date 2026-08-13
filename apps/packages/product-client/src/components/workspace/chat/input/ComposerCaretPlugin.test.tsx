// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from "lexical";
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

describe("ComposerCaretPlugin", () => {
  it("keeps repeated horizontal arrows inert in an empty editor", async () => {
    mockRangeRect({ height: 15, left: 24, top: 18 });
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const harness = renderEditor({
      value: "",
      onChange,
      canSubmit: false,
      onSubmit,
    });
    await harness.ready();
    mockComposerBounds(harness.root, harness.frame);

    act(() => {
      harness.root.focus();
      resetText(harness.editor, "");
    });
    onChange.mockClear();

    for (const key of ["ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight"]) {
      expect(fireEvent.keyDown(harness.root, { key })).toBe(true);
      fireEvent(document, new Event("selectionchange"));
    }

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    const caret = harness.frame.querySelector<HTMLElement>(
      "[data-chat-composer-caret]",
    )!;
    expect(caret.style.display).toBe("none");
    expect(harness.root.style.caretColor).toBe("");
    expect(harness.root.textContent).toBe("");
    expect(harness.frame.textContent).toBe("Message");
    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves horizontal caret and selection navigation browser-owned for text", async () => {
    const onChange = vi.fn();
    const harness = renderEditor({ value: "draft", onChange });
    await harness.ready();

    act(() => {
      harness.editor.update(() => {
        $getRoot().getAllTextNodes()[0]!.select(3, 3);
      }, { discrete: true });
    });
    onChange.mockClear();

    expect(fireEvent.keyDown(harness.root, { key: "ArrowLeft" })).toBe(true);
    expect(fireEvent.keyDown(harness.root, { key: "ArrowRight" })).toBe(true);

    act(() => {
      harness.editor.update(() => {
        $getRoot().getAllTextNodes()[0]!.select(1, 4);
      }, { discrete: true });
    });
    expect(
      fireEvent.keyDown(harness.root, { key: "ArrowLeft", shiftKey: true }),
    ).toBe(true);
    expect(
      fireEvent.keyDown(harness.root, { key: "ArrowRight", shiftKey: true }),
    ).toBe(true);

    harness.editor.getEditorState().read(() => {
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if ($isRangeSelection(selection)) {
        expect(selection.anchor.offset).toBe(1);
        expect(selection.focus.offset).toBe(4);
      }
    });
    expect(harness.root.textContent).toBe("draft");
    expect(onChange).not.toHaveBeenCalled();
  });
});

function renderEditor(overrides: Partial<ComposerRichTextEditorProps> = {}) {
  let editor: LexicalEditor | null = null;
  const rendered = render(
    <ComposerRichTextEditor
      value="seed"
      onChange={vi.fn()}
      canSubmit
      onSubmit={vi.fn()}
      placeholder="Message"
      disabled={false}
      editorRef={(next) => {
        editor = next;
      }}
      {...overrides}
    />,
  );
  const root = rendered.container.querySelector<HTMLElement>(
    "[data-chat-composer-editor]",
  )!;
  const frame = rendered.container.querySelector<HTMLElement>(
    "[data-chat-composer-editor-frame]",
  )!;
  return {
    get editor() {
      return editor!;
    },
    frame,
    root,
    ready: () => waitFor(() => expect(editor).toBeTruthy()),
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

function resetText(editor: LexicalEditor, text: string) {
  editor.update(() => {
    const paragraph = $createParagraphNode();
    if (text) paragraph.append($createTextNode(text));
    $getRoot().clear().append(paragraph);
    paragraph.selectEnd();
  }, { discrete: true });
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
