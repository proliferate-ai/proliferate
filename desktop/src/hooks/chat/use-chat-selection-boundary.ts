import { useEffect } from "react";

/**
 * Constrains text selection so that drag-selecting cannot cross a single
 * "selection unit" boundary inside the chat view. A unit is any element
 * tagged with `data-chat-selection-unit` — typically a whole message
 * (user bubble, assistant message, agent result, reasoning body, plan body,
 * plan-attached-panel markdown).
 *
 * Why this exists: when the native browser selection crosses multiple
 * sibling blocks, it paints full-width "connecting rectangles" in the gaps
 * between them (margin, padding, flex gap). In the chat transcript those
 * connecting rectangles span the full `max-w-3xl` column and look like
 * ugly horizontal slabs in the empty vertical space between messages.
 * There is no CSS property that suppresses them — `user-select: contain`
 * would, but WebKit (Tauri on macOS) does not support it.
 *
 * Mechanic: listen to `selectionchange` at the document level. On each
 * change, walk up from the selection's anchor node to find the nearest
 * ancestor marked `data-chat-selection-unit`. If the focus node is inside
 * a *different* unit (or outside any unit), clip the focus back to the
 * boundary of the anchor's unit via `Selection.extend()`. Direction of
 * the clip (start vs. end of the anchor unit) is decided by document
 * order so that forward and backward drags both feel natural.
 *
 * Selections whose anchor is outside any chat-selection-unit (e.g. a
 * drag that started in the settings pane or composer textarea) are left
 * untouched.
 */
export function useChatSelectionBoundary() {
  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

      const anchor = sel.anchorNode;
      const focus = sel.focusNode;
      if (!anchor || !focus) return;

      const anchorUnit = findSelectionUnit(anchor);
      if (!anchorUnit) return;

      const focusUnit = findSelectionUnit(focus);
      if (focusUnit === anchorUnit) return;

      const position = anchor.compareDocumentPosition(focus);
      const focusIsForward =
        (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

      const clipTo = focusIsForward
        ? findLastTextPosition(anchorUnit)
        : findFirstTextPosition(anchorUnit);

      if (clipTo) {
        sel.extend(clipTo.node, clipTo.offset);
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);
}

function findSelectionUnit(node: Node): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const el = current as HTMLElement;
      if (el.hasAttribute("data-chat-selection-unit")) {
        return el;
      }
    }
    current = current.parentNode;
  }
  return null;
}

function findLastTextPosition(
  el: HTMLElement,
): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last: Node | null = null;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    last = node;
  }
  if (last) {
    return { node: last, offset: last.textContent?.length ?? 0 };
  }
  return null;
}

function findFirstTextPosition(
  el: HTMLElement,
): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (first) {
    return { node: first, offset: 0 };
  }
  return null;
}
