// @vitest-environment jsdom

import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  scratchMarkdownLanguage,
} from "@/hooks/workspaces/lifecycle/scratch-codemirror-extensions";
import {
  scratchLivePreview,
} from "@/hooks/workspaces/lifecycle/scratch-codemirror-live-preview";

let view: EditorView | null = null;

function createView(doc: string, cursor: number) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [scratchMarkdownLanguage(), scratchLivePreview],
    }),
  });
  return view;
}

afterEach(() => {
  view?.destroy();
  view = null;
});

describe("scratchLivePreview", () => {
  it("hides strong-emphasis markers when the selection is elsewhere", () => {
    const editor = createView("note **bold** end", 0);
    expect(editor.contentDOM.textContent).toContain("bold");
    expect(editor.contentDOM.textContent).not.toContain("**");
  });

  it("reveals raw markers when the selection touches the formatted span", () => {
    const editor = createView("note **bold** end", 8);
    expect(editor.contentDOM.textContent).toContain("**bold**");
  });

  it("hides backticks and wraps inline code in a chip", () => {
    const editor = createView("see `code` here", 0);
    expect(editor.contentDOM.textContent).not.toContain("`");
    const chip = editor.contentDOM.querySelector(".scratch-inline-code");
    expect(chip?.textContent).toBe("code");
  });

  it("hides the heading marker when the selection is on another line", () => {
    const editor = createView("para\n\n# Title", 0);
    expect(editor.contentDOM.textContent).toContain("Title");
    expect(editor.contentDOM.textContent).not.toContain("# Title");
  });

  it("reveals the heading marker when the selection is on the heading line", () => {
    const doc = "para\n\n# Title";
    const editor = createView(doc, doc.length);
    expect(editor.contentDOM.textContent).toContain("# Title");
  });

  it("hides link syntax and keeps the link text", () => {
    const editor = createView("see [docs](https://example.com) here", 0);
    expect(editor.contentDOM.textContent).toContain("docs");
    expect(editor.contentDOM.textContent).not.toContain("https://example.com");
    expect(editor.contentDOM.textContent).not.toContain("[");
  });

  it("does not parse a lone dash under a paragraph as a setext heading", () => {
    const editor = createView("hello\n- ", 8);
    let sawSetextHeading = false;
    syntaxTree(editor.state).iterate({
      enter: (node) => {
        if (node.name.startsWith("SetextHeading")) {
          sawSetextHeading = true;
        }
      },
    });
    expect(sawSetextHeading).toBe(false);
  });
});
