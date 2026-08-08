import { useEffect } from "react";
import {
  $addUpdateTag,
  $createParagraphNode,
  $isLineBreakNode,
  $isParagraphNode,
  HISTORY_PUSH_TAG,
  type LexicalNode,
  TextNode,
} from "lexical";
import { $generateNodesFromMarkdownString } from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMPOSER_CODE_TRANSFORMER,
  findCompleteComposerCodeFence,
} from "#product/components/workspace/chat/input/ComposerCodeFenceMarkdown";
import {
  selectComposerContinuationAfter,
} from "#product/components/workspace/chat/input/ComposerEditorDocument";

/** Promotes a typed Markdown fence only after its matching close fence exists. */
export function ComposerFencedCodePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => editor.registerNodeTransform(TextNode, (textNode) => {
    const paragraph = textNode.getParent();
    if (!$isParagraphNode(paragraph) || paragraph.getParent()?.getType() !== "root") {
      return;
    }
    const markdown = paragraph.getTextContent();
    const fence = findCompleteComposerCodeFence(markdown);
    if (!fence) return;

    const importedNodes = $generateNodesFromMarkdownString(
      fence.markdown,
      [COMPOSER_CODE_TRANSFORMER],
    );
    const codeNode = importedNodes.length === 1 ? importedNodes[0] : null;
    if (!codeNode || codeNode.getType() !== "code") return;

    const children = paragraph.getChildren();
    const fenceStart = childBoundaryAtOffset(children, fence.start);
    const fenceEnd = childBoundaryAtOffset(children, fence.end);
    if (fenceStart === null || fenceEnd === null) return;

    let replaceStart = fenceStart;
    let replaceEnd = fenceEnd;
    if ($isLineBreakNode(children[replaceStart - 1])) replaceStart -= 1;
    if ($isLineBreakNode(children[replaceEnd])) replaceEnd += 1;

    const suffixChildren = children.slice(replaceEnd);
    const suffix = suffixChildren.length > 0 ? $createParagraphNode() : null;
    suffix?.append(...suffixChildren);
    for (const child of children.slice(replaceStart, replaceEnd)) child.remove();

    if (paragraph.isEmpty()) paragraph.replace(codeNode);
    else paragraph.insertAfter(codeNode);
    if (suffix) codeNode.insertAfter(suffix);
    selectComposerContinuationAfter([codeNode]);
    $addUpdateTag(HISTORY_PUSH_TAG);
  }), [editor]);

  return null;
}

function childBoundaryAtOffset(
  children: readonly LexicalNode[],
  targetOffset: number,
): number | null {
  let traversed = 0;
  for (let index = 0; index < children.length; index += 1) {
    if (targetOffset === traversed) return index;
    traversed += children[index]!.getTextContentSize();
    if (targetOffset === traversed) return index + 1;
  }
  return targetOffset === traversed ? children.length : null;
}
