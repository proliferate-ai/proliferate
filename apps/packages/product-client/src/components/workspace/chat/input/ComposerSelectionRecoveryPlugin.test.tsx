// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $getRoot, type LexicalEditor } from "lexical";
import { ComposerRichTextEditor } from "#product/components/workspace/chat/input/ComposerRichTextEditor";

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
  // jsdom Ranges have no layout; Lexical's post-commit scroll-into-view reads
  // the caret range's rect.
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 0, height: 0, left: 0, right: 0, toJSON: () => ({}),
      top: 0, width: 0, x: 0, y: 0,
    }),
  });
  vi.stubGlobal("DragEvent", class DragEvent extends Event {});
  vi.stubGlobal("ClipboardEvent", class ClipboardEvent extends Event {});
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
});

// WebKit clears the document selection while the composer keeps DOM focus
// (native attach-file dialog, cancelled external drags) and then emits no
// beforeinput for any keystroke, so typing dies under a live-looking caret
// (PRO-294). The recovery plugin must re-seat the editor state's selection in
// the DOM on the first input-producing keystroke.
describe("ComposerSelectionRecoveryPlugin", () => {
  it("restores the DOM selection on a printable keystroke after it was cleared", async () => {
    const harness = renderEditor("draft");
    await harness.ready();

    act(() => {
      harness.root.focus();
      harness.editor.update(() => {
        $getRoot().getAllTextNodes()[0]!.select(3, 3);
      }, { discrete: true });
    });
    act(() => {
      document.getSelection()!.removeAllRanges();
    });
    expect(document.getSelection()!.rangeCount).toBe(0);
    expect(document.activeElement).toBe(harness.root);

    act(() => {
      fireEvent.keyDown(harness.root, { key: "x" });
    });

    const selection = document.getSelection()!;
    expect(selection.rangeCount).toBe(1);
    expect(
      harness.root.contains(selection.getRangeAt(0).startContainer),
    ).toBe(true);
  });

  it("leaves modifier chords alone so a transcript selection can still be copied", async () => {
    const harness = renderEditor("draft");
    await harness.ready();

    act(() => {
      harness.root.focus();
      harness.editor.update(() => {
        $getRoot().getAllTextNodes()[0]!.select(3, 3);
      }, { discrete: true });
    });
    act(() => {
      document.getSelection()!.removeAllRanges();
    });

    act(() => {
      fireEvent.keyDown(harness.root, { key: "c", metaKey: true });
    });

    expect(document.getSelection()!.rangeCount).toBe(0);
  });

  it("does not touch a selection that already sits inside the editor", async () => {
    const harness = renderEditor("draft");
    await harness.ready();

    act(() => {
      harness.root.focus();
      harness.editor.update(() => {
        $getRoot().getAllTextNodes()[0]!.select(2, 2);
      }, { discrete: true });
    });
    const before = describeSelection();

    act(() => {
      fireEvent.keyDown(harness.root, { key: "x" });
    });

    expect(describeSelection()).toEqual(before);
  });
});

function describeSelection() {
  const selection = document.getSelection()!;
  if (selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return { node: range.startContainer, offset: range.startOffset };
}

function renderEditor(value: string) {
  let editor: LexicalEditor | null = null;
  const rendered = render(
    <ComposerRichTextEditor
      value={value}
      onChange={vi.fn()}
      canSubmit
      onSubmit={vi.fn()}
      placeholder="Message"
      disabled={false}
      editorRef={(next) => {
        editor = next;
      }}
    />,
  );
  const root = rendered.container.querySelector<HTMLElement>(
    "[data-chat-composer-editor]",
  )!;
  return {
    get editor() {
      return editor!;
    },
    root,
    ready: () => waitFor(() => expect(editor).toBeTruthy()),
  };
}
