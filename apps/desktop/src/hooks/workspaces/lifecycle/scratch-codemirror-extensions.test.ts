// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  scratchEditorTheme,
  scratchListDecorations,
  scratchMarkdownLanguage,
} from "@/hooks/workspaces/lifecycle/scratch-codemirror-extensions";

let view: EditorView | null = null;

function createView(doc: string) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [scratchMarkdownLanguage(), scratchEditorTheme, scratchListDecorations],
    }),
  });
  return view;
}

function collectStyleText() {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        rules.push(rule.cssText);
      }
    } catch {
      // Ignore opaque sheets; CodeMirror injects a readable local sheet.
    }
  }
  return rules.join("\n");
}

afterEach(() => {
  view?.destroy();
  view = null;
});

describe("scratchListDecorations", () => {
  it("renders ordered markdown markers as ordered markers", () => {
    const editor = createView("1. first");

    const marker = editor.contentDOM.querySelector(".scratch-list-marker--ordered");
    expect(marker?.textContent).toBe("1. ");
    expect(editor.contentDOM.textContent).not.toContain("•");

    const styleText = collectStyleText();
    expect(styleText).toContain("font-variant-numeric: tabular-nums");
    expect(styleText).toContain("justify-content: flex-start");
  });

  it("renders parenthesized ordered markdown markers as ordered markers", () => {
    const editor = createView("1) first");

    const marker = editor.contentDOM.querySelector(".scratch-list-marker--ordered");
    expect(marker?.textContent).toBe("1) ");
    expect(editor.contentDOM.textContent).not.toContain("•");
  });
});
