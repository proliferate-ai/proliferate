import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
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
  ListNode,
  ListItemNode,
  LinkNode,
  ComposerFileMentionNode,
];

/**
 * Markdown recognized while editing.
 *
 * Emphasis and lists become real nodes as the user types. A workspace file link
 * becomes a mention chip. A web link is intentionally absent, so
 * `[Docs](https://example.com)` typed into the draft stays literal text — the
 * paste plugin, not typing, is what creates web links.
 */
export const COMPOSER_INPUT_TRANSFORMERS: Transformer[] = [
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
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
    return { plainText, anchorOffset: plainText.length, focusOffset: plainText.length };
  }
  return {
    plainText,
    anchorOffset: globalPointOffset(selection.anchor.getNode(), selection.anchor.offset),
    focusOffset: globalPointOffset(selection.focus.getNode(), selection.focus.offset),
  };
}

export function getComposerEditorContext(editor: LexicalEditor): ComposerEditorContext {
  let context: ComposerEditorContext = { plainText: "", anchorOffset: 0, focusOffset: 0 };
  editor.getEditorState().read(() => { context = readComposerEditorContext(); });
  return context;
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
  let offset = 0;
  for (const textNode of $getRoot().getAllTextNodes()) {
    if (textNode.is(node)) return offset + localOffset;
    offset += textNode.getTextContentSize();
  }
  return offset;
}

function pointAtOffset(offset: number): { node: TextNode; offset: number } | null {
  const nodes = $getRoot().getAllTextNodes();
  let traversed = 0;
  for (const node of nodes) {
    const end = traversed + node.getTextContentSize();
    if (offset <= end) return { node, offset: Math.max(0, offset - traversed) };
    traversed = end;
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last, offset: last.getTextContentSize() } : null;
}
