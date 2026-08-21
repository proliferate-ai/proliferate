// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KEY_ENTER_COMMAND, type LexicalEditor } from "lexical";
import {
  ComposerRichTextEditor,
  type ComposerRichTextEditorProps,
} from "#product/components/workspace/chat/input/ComposerRichTextEditor";

/**
 * The refusal seam: Enter with sending refused is still swallowed, but the
 * surface now hears about it. Home turns that into a focus move and an
 * announcement; without it a refused Enter is indistinguishable from a
 * keystroke that went nowhere.
 */

afterEach(cleanup);

describe("ComposerRichTextEditor submit refusal", () => {
  it("reports a refused Enter instead of silently swallowing it", async () => {
    const onSubmit = vi.fn();
    const onSubmitRefused = vi.fn();
    const harness = renderEditor({ canSubmit: false, onSubmit, onSubmitRefused });
    await harness.ready();

    const enter = keyEvent("Enter", { cancelable: true });
    act(() => {
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, enter);
    });

    // Still swallowed — a refused send must never insert a newline — but the
    // surface now learns the user asked, which is what Home announces on.
    expect(enter.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSubmitRefused).toHaveBeenCalledTimes(1);

    const again = keyEvent("Enter", { cancelable: true });
    act(() => {
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, again);
    });
    expect(onSubmitRefused).toHaveBeenCalledTimes(2);
  });

  it("does not report a refusal when the send goes through", async () => {
    const onSubmitRefused = vi.fn();
    const harness = renderEditor({ canSubmit: true, onSubmitRefused });
    await harness.ready();

    act(() => {
      harness.editor.dispatchCommand(KEY_ENTER_COMMAND, keyEvent("Enter", { cancelable: true }));
    });
    expect(onSubmitRefused).not.toHaveBeenCalled();
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
  render(<ComposerRichTextEditor {...props} />);
  return {
    get editor() { return editor!; },
    ready: () => waitFor(() => expect(editor).toBeTruthy()),
  };
}

function keyEvent(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, bubbles: true, ...init });
}
