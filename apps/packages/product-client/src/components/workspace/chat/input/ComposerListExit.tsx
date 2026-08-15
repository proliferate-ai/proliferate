// List-exit surgery for the chat composer (PRO-267). Lexical's stock
// OUTDENT_CONTENT_COMMAND only shrinks nesting, so it is a silent no-op for
// items already at the top level — and since plain Enter submits in the
// composer, lists were inescapable. The composer owns the missing exits:
// Shift+Tab outdents top-level items into paragraphs, and Shift+Enter exits
// from an empty item or an empty trailing line.

import {
  $createParagraphNode,
  $getSelection,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  OUTDENT_CONTENT_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type ParagraphNode,
} from "lexical";
import { $isListItemNode, $isListNode, type ListItemNode } from "@lexical/list";

export function $nearestListItem(node: LexicalNode): ListItemNode | null {
  let current: LexicalNode | null = node;
  while (current !== null && !$isListItemNode(current)) current = current.getParent();
  return $isListItemNode(current) ? current : null;
}

// The missing outdent step for indent-0 items — each becomes a paragraph,
// splitting its list around it. Nested items (and wrapper items holding a
// nested list) still take Lexical's own outdent path.
export function $outdentTopLevelListItems(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  const items = new Set<ListItemNode>();
  for (const node of selection.getNodes()) {
    const item = $nearestListItem(node);
    if (item) items.add(item);
  }
  if (items.size === 0) return false;
  for (const item of items) {
    if (item.getIndent() > 0 || item.getChildren().some($isListNode)) return false;
  }
  for (const item of items) $convertListItemToParagraph(item);
  return true;
}

// Plain Enter submits the message, so Shift+Enter doubles as the list exit:
// on an empty item it leaves the list (or un-nests one level), and on an
// empty trailing line it moves the caret into a paragraph below the list.
export function $exitListForShiftEnter(editor: LexicalEditor): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const item = $nearestListItem(selection.anchor.getNode());
  if (!item) return false;
  const effectivelyEmpty = item
    .getChildren()
    .every((child) => $isTextNode(child) && child.getTextContentSize() === 0);
  if (effectivelyEmpty) {
    if (item.getIndent() > 0) return editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);
    $convertListItemToParagraph(item);
    return true;
  }
  if (item.getIndent() > 0) return false;
  const { anchor } = selection;
  const caretOnEmptyTrailingLine = $isLineBreakNode(item.getLastChild())
    && anchor.type === "element"
    && anchor.getNode().is(item)
    && anchor.offset === item.getChildrenSize();
  if (!caretOnEmptyTrailingLine) return false;
  item.getLastChild()?.remove();
  const list = item.getParentOrThrow();
  const trailingStart = $orderedStartAfter(item);
  const nextItem = item.getNextSibling();
  const paragraph = $createParagraphNode();
  item.insertAfter(paragraph);
  $healTrailingList(paragraph, nextItem, trailingStart);
  if (item.getChildrenSize() === 0) {
    item.remove();
    if (list.isAttached() && list.getChildrenSize() === 0) list.remove();
  }
  paragraph.selectEnd();
  return true;
}

function $convertListItemToParagraph(item: ListItemNode): void {
  const trailingStart = $orderedStartAfter(item);
  const nextItem = item.getNextSibling();
  // ListItemNode.replace splits the list around the item, transfers its
  // children, remaps an element-anchored caret, and prunes the emptied list.
  const paragraph = item.replace($createParagraphNode(), true);
  $healTrailingList(paragraph, nextItem, trailingStart);
}

// Visible number the items after `item` should keep once a paragraph lands
// before them, or null for unordered lists.
function $orderedStartAfter(item: ListItemNode): number | null {
  const list = item.getParent();
  if (!$isListNode(list) || list.getListType() !== "number") return null;
  return list.getStart() + item.getIndexWithinParent() + 1;
}

// After a paragraph lands between the halves of a split list, the trailing
// half restarts ordered numbering at the head's start, and when the exited
// item owned a nested sublist, that sublist's wrapper now leads the trailing
// half as an indented bullet with no parent. Repair both.
function $healTrailingList(
  paragraph: ParagraphNode,
  firstTrailingItem: LexicalNode | null,
  orderedStart: number | null,
): void {
  if (!$isListItemNode(firstTrailingItem)) return;
  const trailingList = firstTrailingItem.getParent();
  if (!$isListNode(trailingList) || trailingList.getPreviousSibling() !== paragraph) return;
  if (orderedStart !== null && trailingList.getListType() === "number") {
    trailingList.setStart(orderedStart);
  }
  const first = trailingList.getFirstChild();
  if (!$isListItemNode(first)) return;
  const children = first.getChildren();
  const orphanedSublist = children.length === 1 ? children[0] : null;
  if (!$isListNode(orphanedSublist)) return;
  for (const promoted of orphanedSublist.getChildren()) first.insertBefore(promoted);
  first.remove();
}
