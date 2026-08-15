import { useEffect } from "react";
import {
  $isElementNode,
  IS_BOLD,
  IS_ITALIC,
  ParagraphNode,
  TextNode,
  type Klass,
  type LexicalNode,
} from "lexical";
import { $isListItemNode, ListItemNode, ListNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMPOSER_CODE_TRANSFORMER } from "#product/components/workspace/chat/input/ComposerCodeFenceMarkdown";

const AUTHORABLE_TEXT_FORMATS = IS_BOLD | IS_ITALIC;

const BLOCK_NODE_KLASSES: Array<Klass<LexicalNode>> = [
  ParagraphNode,
  ListNode,
  ListItemNode,
  COMPOSER_CODE_TRANSFORMER.dependencies[0]!,
];

/**
 * Drops formatting the composer's document model cannot author.
 *
 * Rich pastes import more than the model: alignment and indent on block
 * elements, and text formats beyond bold and italic. None of it survives the
 * Markdown serialization boundary, so keeping it shows a draft the submitted
 * prompt won't match — a pasted centered paragraph stays centered with no way
 * to clear it (PRO-265) — or invisibly re-applies to later input (PRO-159's
 * inline-code format). Keep the characters and structure, drop the formatting.
 */
export function ComposerFormatGuardPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterTransforms = [
      editor.registerNodeTransform(TextNode, (textNode) => {
        const format = textNode.getFormat() & AUTHORABLE_TEXT_FORMATS;
        if (textNode.getFormat() !== format) textNode.setFormat(format);
      }),
      ...BLOCK_NODE_KLASSES.map((klass) => editor.registerNodeTransform(klass, (node) => {
        if (!$isElementNode(node)) return;
        if (node.getFormatType() !== "") node.setFormat("");
        // List-item indent is real structure (setIndent nests or unnests the
        // item); everywhere else it is paste debris with no way to remove it.
        if (!$isListItemNode(node) && node.getIndent() !== 0) node.setIndent(0);
      })),
    ];
    return () => { for (const unregister of unregisterTransforms) unregister(); };
  }, [editor]);

  return null;
}
