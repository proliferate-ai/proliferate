import {
  $createParagraphNode,
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
  type TextNode,
} from "lexical";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import {
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  UNORDERED_LIST,
  type Transformer,
} from "@lexical/markdown";
import {
  COMPOSER_FILE_MENTION_TRANSFORMER,
  ComposerFileMentionNode,
} from "#product/components/workspace/chat/input/ComposerFileMentionNode";
import {
  COMPOSER_CONTEXT_DOC_MENTION_TRANSFORMER,
  ComposerContextDocMentionNode,
} from "#product/components/workspace/chat/input/ComposerContextDocMentionNode";
import {
  COMPOSER_CODE_TRANSFORMER,
  isComposerOffsetInsideOpenCodeFence,
} from "#product/components/workspace/chat/input/ComposerCodeFenceMarkdown";

/**
 * The composer's document model: which node types exist in a draft, how markdown
 * maps onto them, and how a plain-text offset range is edited.
 *
 * This is deliberately separate from the editor component. The component owns
 * rendering and plugin wiring; everything here is the contract the composer's
 * other surfaces (the inline menus, the paste plugin, tests) program against,
 * and none of it needs React.
 */
export const COMPOSER_NODES = [
  ...COMPOSER_CODE_TRANSFORMER.dependencies,
  ListNode,
  ListItemNode,
  LinkNode,
  ComposerFileMentionNode,
  ComposerContextDocMentionNode,
];

/**
 * Markdown recognized while editing.
 *
 * Emphasis, lists, and complete fenced code blocks become real nodes as the
 * user types. A workspace file link becomes a mention chip. A web link is
 * intentionally absent, so
 * `[Docs](https://example.com)` typed into the draft stays literal text — the
 * paste plugin, not typing, is what creates web links.
 */
export const COMPOSER_INPUT_TRANSFORMERS: Transformer[] = [
  COMPOSER_CODE_TRANSFORMER,
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  // The context-doc transformer's `@doc:` destination contains a `:`, which the
  // file transformer's body excludes, so the order of the two mention
  // transformers carries no meaning — neither can match the other's text.
  COMPOSER_CONTEXT_DOC_MENTION_TRANSFORMER,
  COMPOSER_FILE_MENTION_TRANSFORMER,
];

/** Markdown written back out to the prompt, which does include web links. */
export const COMPOSER_OUTPUT_TRANSFORMERS: Transformer[] = [
  ...COMPOSER_INPUT_TRANSFORMERS,
  LINK,
];

export interface ComposerEditorContext {
  plainText: string;
  anchorOffset: number;
  focusOffset: number;
  selectionInCodeBlock: boolean;
}

/**
 * Flattens the draft to plain text plus caret offsets.
 *
 * The inline menus reason about the prompt as a string ("is the caret inside an
 * `@` token?"), so the whole-document offset — not the offset within one text
 * node — is the useful coordinate.
 */
export function readComposerEditorContext(): ComposerEditorContext {
  const selection = $getSelection();
  const plainText = $getRoot().getTextContent();
  if (!$isRangeSelection(selection)) {
    return {
      plainText,
      anchorOffset: plainText.length,
      focusOffset: plainText.length,
      selectionInCodeBlock: false,
    };
  }
  return {
    plainText,
    anchorOffset: globalPointOffset(selection.anchor.getNode(), selection.anchor.offset),
    focusOffset: globalPointOffset(selection.focus.getNode(), selection.focus.offset),
    selectionInCodeBlock: isComposerSelectionPointInsideCode(
      selection.focus.getNode(),
      selection.focus.offset,
    ),
  };
}

export function getComposerEditorContext(editor: LexicalEditor): ComposerEditorContext {
  let context: ComposerEditorContext = {
    plainText: "",
    anchorOffset: 0,
    focusOffset: 0,
    selectionInCodeBlock: false,
  };
  editor.getEditorState().read(() => { context = readComposerEditorContext(); });
  return context;
}

export function isComposerNodeInsideCodeBlock(node: LexicalNode): boolean {
  let current: LexicalNode | null = node;
  while (current) {
    if (current.getType() === "code") return true;
    current = current.getParent();
  }
  return false;
}

export function isComposerSelectionPointInsideCode(
  node: LexicalNode,
  offset: number,
): boolean {
  if (isComposerNodeInsideCodeBlock(node)) return true;

  let paragraph: LexicalNode | null = node;
  while (paragraph && paragraph.getParent()?.getType() !== "root") {
    paragraph = paragraph.getParent();
  }
  if (!paragraph || paragraph.getType() !== "paragraph") return false;

  const pointOffset = offsetWithinNode(node, offset, paragraph);
  return pointOffset !== null && isComposerOffsetInsideOpenCodeFence(
    paragraph.getTextContent(),
    pointOffset,
  );
}

/** Moves the caret after an imported block so normal typing can continue. */
export function selectComposerContinuationAfter(nodes: readonly LexicalNode[]) {
  const lastNode = nodes[nodes.length - 1];
  if (!lastNode) return;
  if (lastNode.getType() !== "code") {
    $setSelection(null);
    lastNode.selectEnd();
    return;
  }

  const nextNode = lastNode.getNextSibling();
  if (nextNode) {
    $setSelection(null);
    nextNode.selectStart();
    return;
  }
  const continuation = $createParagraphNode();
  lastNode.insertAfter(continuation);
  $setSelection(null);
  continuation.selectStart();
}

export function replaceComposerTextRange(
  editor: LexicalEditor,
  start: number,
  end: number,
  replacement: string,
) {
  replaceComposerRange(editor, start, end, (selection) => {
    selection.insertText(replacement);
  });
}

/**
 * Replaces a plain-text range with real nodes.
 *
 * Node insertion cannot go through {@link replaceComposerTextRange}: markdown
 * typed in one shot never reaches the markdown shortcut plugin (it only fires on
 * single-character edits), so a surface that wants a chip has to build the node
 * itself. `createNodes` runs inside the editor update, which is the only place
 * `$create*` calls are legal.
 */
export function replaceComposerRangeWithNodes(
  editor: LexicalEditor,
  start: number,
  end: number,
  createNodes: () => LexicalNode[],
) {
  replaceComposerRange(editor, start, end, (selection) => {
    selection.insertNodes(createNodes());
  });
}

function replaceComposerRange(
  editor: LexicalEditor,
  start: number,
  end: number,
  apply: (selection: RangeSelection) => void,
) {
  editor.update(() => {
    const anchor = pointAtOffset(start);
    const focus = pointAtOffset(end);
    if (!anchor || !focus) return;
    const selection = $createRangeSelection();
    selection.setTextNodeRange(anchor.node, anchor.offset, focus.node, focus.offset);
    $setSelection(selection);
    apply(selection);
  });
}

function globalPointOffset(node: LexicalNode, localOffset: number): number {
  return offsetWithinNode(node, localOffset, $getRoot())
    ?? $getRoot().getTextContentSize();
}

function offsetWithinNode(
  node: LexicalNode,
  localOffset: number,
  ancestor: LexicalNode,
): number | null {
  let current: LexicalNode | null = node;
  let offset = $isElementNode(node)
    ? textSizeBeforeChild(node, localOffset)
    : localOffset;
  while (current && !current.is(ancestor)) {
    for (const sibling of current.getPreviousSiblings()) {
      offset += sibling.getTextContentSize();
      if ($isElementNode(sibling) && !sibling.isInline()) offset += 2;
    }
    current = current.getParent();
  }
  return current ? offset : null;
}

function pointAtOffset(offset: number): { node: TextNode; offset: number } | null {
  let traversed = 0;
  let point: { node: TextNode; offset: number } | null = null;
  const visit = (node: LexicalNode) => {
    if (point) return;
    if ($isElementNode(node)) {
      const children = node.getChildren();
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index]!;
        visit(child);
        if (point) return;
        if (
          index < children.length - 1
          && $isElementNode(child)
          && !child.isInline()
        ) traversed += 2;
      }
      return;
    }
    if (node.getType() !== "text") {
      traversed += node.getTextContentSize();
      return;
    }
    const textNode = node as TextNode;
    const end = traversed + textNode.getTextContentSize();
    if (offset >= traversed && offset <= end) {
      point = { node: textNode, offset: offset - traversed };
    }
    traversed = end;
  };
  visit($getRoot());
  if (point) return point;
  const textNodes = $getRoot().getAllTextNodes();
  const last = textNodes[textNodes.length - 1];
  return last ? { node: last, offset: last.getTextContentSize() } : null;
}

function textSizeBeforeChild(node: ElementNode, end: number) {
  const children = node.getChildren();
  let size = 0;
  for (let index = 0; index < Math.min(end, children.length); index += 1) {
    const child = children[index]!;
    size += child.getTextContentSize();
    if (
      index < children.length - 1
      && $isElementNode(child)
      && !child.isInline()
    ) size += 2;
  }
  return size;
}
