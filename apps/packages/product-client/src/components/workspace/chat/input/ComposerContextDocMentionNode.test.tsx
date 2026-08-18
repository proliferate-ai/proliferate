// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { $getRoot, createEditor, type LexicalEditor, type LexicalNode } from "lexical";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import {
  COMPOSER_INPUT_TRANSFORMERS,
  COMPOSER_NODES,
  COMPOSER_OUTPUT_TRANSFORMERS,
} from "#product/components/workspace/chat/input/ComposerEditorDocument";
import {
  $isComposerContextDocMentionNode,
  ComposerContextDocMentionNode,
} from "#product/components/workspace/chat/input/ComposerContextDocMentionNode";
import { $isComposerFileMentionNode } from "#product/components/workspace/chat/input/ComposerFileMentionNode";

function createComposerTestEditor(): LexicalEditor {
  return createEditor({
    nodes: COMPOSER_NODES,
    onError: (error) => {
      throw error;
    },
  });
}

function importDraft(editor: LexicalEditor, markdown: string): void {
  editor.update(() => {
    $convertFromMarkdownString(markdown, COMPOSER_INPUT_TRANSFORMERS);
  }, { discrete: true });
}

function exportDraft(editor: LexicalEditor): string {
  let markdown = "";
  editor.getEditorState().read(() => {
    markdown = $convertToMarkdownString(COMPOSER_OUTPUT_TRANSFORMERS);
  });
  return markdown;
}

function firstParagraphChildren(editor: LexicalEditor): LexicalNode[] {
  let children: LexicalNode[] = [];
  editor.getEditorState().read(() => {
    const paragraph = $getRoot().getFirstChild();
    children = paragraph && "getChildren" in paragraph
      ? (paragraph as { getChildren(): LexicalNode[] }).getChildren()
      : [];
  });
  return children;
}

describe("ComposerContextDocMentionNode markdown round-trip", () => {
  it("round-trips a draft holding a context-doc mention, a file mention, and a web link", () => {
    const markdown = "Check [01-plan.md](@doc:run-01j8/01-plan.md) against "
      + "[setup.md](docs/setup.md) and [Docs](https://example.com) now";
    const editor = createComposerTestEditor();

    importDraft(editor, markdown);

    const children = firstParagraphChildren(editor);
    const docNodes = children.filter($isComposerContextDocMentionNode);
    const fileNodes = children.filter($isComposerFileMentionNode);
    expect(docNodes).toHaveLength(1);
    expect(fileNodes).toHaveLength(1);
    editor.getEditorState().read(() => {
      expect(docNodes[0]?.getRef()).toEqual({ runId: "run-01j8", filename: "01-plan.md" });
      expect(docNodes[0]?.getTextContent()).toBe("01-plan.md");
      // The typed web link stays literal text: no link node, no mention chip.
      expect($getRoot().getTextContent()).toContain("[Docs](https://example.com)");
    });

    expect(exportDraft(editor)).toBe(markdown);
  });

  it("never lets the two mention serializations claim each other", () => {
    const editor = createComposerTestEditor();

    importDraft(editor, "[setup.md](docs/setup.md) then [01-plan.md](@doc:run-01j8/01-plan.md)");

    const children = firstParagraphChildren(editor);
    const docNodes = children.filter($isComposerContextDocMentionNode);
    const fileNodes = children.filter($isComposerFileMentionNode);
    expect(docNodes).toHaveLength(1);
    expect(fileNodes).toHaveLength(1);
    editor.getEditorState().read(() => {
      // The file mention kept its workspace path; the doc mention kept its ref.
      expect(fileNodes[0]?.getTextContent()).toBe("setup.md");
      expect(docNodes[0]?.getRef().runId).toBe("run-01j8");
    });
  });

  it("leaves a doc-shaped token with an invalid destination as plain text", () => {
    const editor = createComposerTestEditor();

    importDraft(editor, "See [plan](@doc:no-separator) here");

    const children = firstParagraphChildren(editor);
    expect(children.some($isComposerContextDocMentionNode)).toBe(false);
    expect(children.some($isComposerFileMentionNode)).toBe(false);
    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe("See [plan](@doc:no-separator) here");
    });
  });

  it("round-trips the ref through JSON serialization", () => {
    const editor = createComposerTestEditor();
    importDraft(editor, "[01-plan.md](@doc:run-01j8/01-plan.md)");
    let serialized: ReturnType<ComposerContextDocMentionNode["exportJSON"]> | null = null;
    editor.getEditorState().read(() => {
      const node = firstDocNode();
      serialized = node?.exportJSON() ?? null;
    });

    function firstDocNode(): ComposerContextDocMentionNode | null {
      const paragraph = $getRoot().getFirstChild();
      const children = paragraph && "getChildren" in paragraph
        ? (paragraph as { getChildren(): LexicalNode[] }).getChildren()
        : [];
      return children.find($isComposerContextDocMentionNode) ?? null;
    }

    expect(serialized).toMatchObject({
      type: "composer-context-doc-mention",
      runId: "run-01j8",
      filename: "01-plan.md",
      text: "01-plan.md",
    });

    const rehydrated = createComposerTestEditor();
    rehydrated.update(() => {
      const node = ComposerContextDocMentionNode.importJSON(serialized!);
      expect(node.getRef()).toEqual({ runId: "run-01j8", filename: "01-plan.md" });
      expect(node.getMode()).toBe("token");
    }, { discrete: true });
  });
});
