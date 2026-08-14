/**
 * macOS WebKit selects the word under the pointer while preparing a context
 * menu — inside the platform's sendContextMenuEvent, after mousedown but
 * before the DOM `contextmenu` event is dispatched — so no preventDefault on
 * either event stops it. A handler that replaces the browser menu calls this
 * synchronously to drop that just-made selection before it ever paints.
 *
 * Only a selection touching `container` is cleared: one living entirely
 * elsewhere cannot be the contextual word under the pointer, and clearing it
 * would destroy a selection the user made on purpose.
 */
export function clearContextualWordSelection(container: EventTarget | null): void {
  if (!(container instanceof Element)) {
    return;
  }
  const selection = container.ownerDocument?.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }
  const { anchorNode, focusNode } = selection;
  const touchesContainer =
    (anchorNode !== null && container.contains(anchorNode))
    || (focusNode !== null && container.contains(focusNode));
  if (touchesContainer) {
    selection.removeAllRanges();
  }
}
